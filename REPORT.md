# Design write-up

A record-once / replay-many computer-use system for legacy back-office applications.
An LLM drives a real UI to accomplish a goal the first time; the run is recorded as a
typed, versioned capability; that capability is then replayed deterministically with no
model in the decision loop.

Everything below was measured against a running system. `DECISIONS.md` carries the
long-form reasoning for each choice, including the bugs that produced several of them.

---

## 1. Architecture

Single TypeScript package, boundaries enforced by the import graph rather than by build
tooling. The brief penalises scaling infrastructure, and a monorepo here would be exactly
that — the property that matters is that `core` imports nothing from `surface` and
`replay` imports nothing from `agent`, which is free.

```
src/core/      capability schema, error taxonomy, policy, redaction, run log
src/surface/   Surface interface + CDP web adapter          <- the portability seam
src/agent/     discovery loop, NIM client, recorder
src/replay/    executor, locator resolver, outcome detection
src/server/    control lease, escalation registry, catalog API
web/           operator console (React, served by the same process)
target-app/    synthetic legacy surface, two tenants
```

Three surfaces, split by audience rather than by technology — the application an agent
drives, the console a human rescues it from, and the API another agent calls:

| surface | audience | auth |
|---|---|---|
| `teller.dexdash.cloud` | the target application | open (synthetic data) |
| `console.dexdash.cloud` | a human operator | authenticated |
| `api.dexdash.cloud` | a calling agent | authenticated |

The console and the API share one process, because they are two views of the same state:
the catalog is how a capability is invoked, and the console is where a stuck one is
rescued. Splitting them would mean shipping a live browser-session handle across a
process boundary for no benefit at this size.

**The load-bearing decision is the `Surface` seam.** Nothing above it imports Playwright
or CDP. Perception is the accessibility tree — `Accessibility.getFullAXTree` over a CDP
session — not the DOM, because role/name/value is the one vocabulary that also exists on
Windows (UI Automation) and macOS (AX API). Building on CSS selectors would have made
the desktop story in §4 fiction.

Playwright 1.63 **removed** `page.accessibility`, so this is CDP directly. That turned out
better anyway: it forced an explicit perception layer rather than a borrowed helper.

TypeScript over Python because the contract is the centrepiece. Zod gives one definition
serving runtime validation, static types, and — via `z.toJSONSchema()` — the tool schema
a calling agent consumes. Three artifacts that cannot drift apart.

Model provider is NVIDIA NIM behind an OpenAI-compatible client, so model choice is
configuration. Measured tool-calling latency decided the default: `gpt-oss-20b` at 775ms
against `glm-5.3` at 14s and `kimi-k3` at 120s. All four emitted correct tool calls; at
~10 calls per run the spread is decisive. Because perception is the AX tree rather than
screenshots, this needs a *text* model, not a vision model — which is what makes a free
tier viable and is a real cost argument for production, not just for this exercise.

---

## 2. Artifact schema

A capability is shaped as a **contract**, not a step list. Inputs, outputs, outcomes and
the success condition are declared at the top level, so a caller or a reviewer can see
what it needs and returns without reading a single step.

```
Capability
  id, version (semver), status: draft | approved | deprecated
  surface  { kind, entryPoint, appProfile { vendorApp, versionRange } }
  tenant   "base" | <tenantId>
  inputs   ParamSpec[]   name, type, required, pattern, sensitivity
  outputs  OutputSpec[]  name, type, source: TargetDescriptor, transform[]
  steps    Step[]        intent, action, riskClass, checkpoint, outcomes[]
  successCondition  Checkpoint
  outcomes OutcomeRule[] code, detector, disposition, recovery, maxAttempts
  policy   { allowedOrigins, allowedActions, confirmAtOrAbove }
  provenance { model, runId, transcriptSha256, humanAssisted }
```

Four decisions worth defending:

**Targeting is a ranked strategy list, not a selector.** Each `TargetDescriptor` carries
ordered strategies with a confidence and a written rationale: scoped role+name →
normalized/aliased name → label proximity → nth-of-role. CSS and XPath are *supported by
the schema but never emitted* — they encode incidental structure, and recording one would
imply robustness exactly where the structure is least meaningful.

**`ambiguityPolicy` defaults to `fail`.** If a strategy matches two nodes, replay stops.
The tempting alternative — take the first — is how automation quietly clicks the wrong
control, and in a back-office banking context a confident wrong action is far worse than
a clean halt.

**One assertion vocabulary serves checkpoints, the success condition, and outcome
detectors.** One evaluator to get right, one concept to review, and it forces the point
that detecting "no such member" is the same kind of act as confirming success.

**Provenance stores a transcript hash, not the transcript.** The transcript is evidence:
large, full of unredacted screen text, and coupling the contract to it would make the
artifact unreviewable.

The schema was validated by hand-authoring a capability against it before the agent
existed. Two things surfaced that way: ranked strategies double as the cross-tenant alias
mechanism, and `relation` on a label-proximity strategy has to be *enforced* rather than
decorative — on a two-column layout the cell to the right of "Name:" and the cell below
it report identical adjacent text.

---

## 3. Determinism & error handling

Replay consults no model. Every choice was made at record time and is read from the
artifact.

**Resolution.** Strategies are tried in recorded order; the first that resolves
*unambiguously* wins, and reaching a low-confidence strategy is logged loudly. Resolution
is a pure function of `(TargetDescriptor, Observation)`, so the entire determinism story
is unit-testable without launching a browser.

**The result contract** is four mutually exclusive arms:

```
success   outputs, extracted and coerced to the declared types
outcome   a legitimate application answer: MEMBER_NOT_FOUND, PERMISSION_DENIED
escalated interventionId, awaiting a human
failed    code, stepId, expected, observed, evidence paths
```

**A business outcome is not throwable.** `BusinessOutcome` is a plain type, not an `Error`
subclass, so the mistake the brief warns about is unrepresentable rather than merely
discouraged. The CLI carries it through to exit codes: an outcome exits 0, a failure
exits 1.

**Outcome detectors run before anything is declared a failure**, and this ordering is the
single most important thing in the engine. When a target will not resolve or a checkpoint
does not hold, the first question is not "what broke" but "is the application answering
us?"

This was originally wrong, and the target app caught it. A click that submits a form
starts a navigation, so observing immediately samples the *old* page; detectors ran once
and missed. Worse, the permission-denied screen reuses the "Member Detail" panel title,
so the checkpoint later matched, every step "passed", and the run died three steps later
with "could not extract outputs" — a clean business outcome reported as an extraction bug.
Outcomes and checkpoints are now polled *together*: after each action we wait until the
page is either where we expected or somewhere we explicitly know about. Runs also got
~5× faster, because the loop exits on recognition instead of waiting out a timeout.

**Measured behaviour** across the seeded states:

| input | condition | result |
|---|---|---|
| `100001` | normal record | `SUCCESS` `{savingsBalance: 8214.55, memberName: "Alina Marsh"}` |
| `200002` | unexpected interstitial | `SUCCESS` — dismissed and continued |
| `200003` | slow load (~6s) | `SUCCESS` — waited it out |
| `999999` | no such member | `OUTCOME MEMBER_NOT_FOUND` |
| `200001` | permission denied | `OUTCOME PERMISSION_DENIED` |
| `12345` | malformed input | `FAILED INPUT_INVALID` in 1ms, before a browser launches |
| `200004` | application error | `FAILED APP_ERROR @s5_search` |

Recovery is bounded by declared attempts and resumes at the *checkpoint*, not by re-running
the action — a dismissed interstitial has usually already advanced the app past the point
the step was trying to reach, and blindly retrying looks for a control that is no longer
there.

**On UI drift**, the brief is right that these apps are stable, so ranked fallbacks plus
loud logging when a low-confidence strategy is reached is the proportionate answer: drift
shows up as a rise in fallback usage before it shows up as failure.

That got tested by accident. Late in the project the target application was restyled from
a bare page into something that looks like real institutional software — per-tenant crest,
branded header, menu bar, breadcrumb, status bar, footer — and the navigation flow changed
with it, so signing in became a full top-frame transition rather than an in-frame
redirect. **Every recorded capability still replayed correctly: 7/7 scenarios, identical
outcomes, no artifact edited.**

A descriptor that says "the textbox whose left-hand label reads Member ID" is indifferent
to a new header, a different palette, an added menu bar and a changed navigation model. A
CSS selector or a coordinate would have broken on any one of them. This is the clearest
evidence in the project for §2's targeting decisions.

---

## 4. Heterogeneity & multi-tenant

**Other surfaces.** The seam is `Surface` — `observe`, `resolve`, and a small action set,
with `SurfaceNode` carrying role, name, value, container and frame path. A desktop adapter
implements the same interface over UIA or AX, which expose the same model. The recorded
artifact does not change at all: a `role_name` or `label_proximity` descriptor means the
same thing on a Windows control tree as in a browser.

Legacy web is already the demonstrated case, not a hypothetical. The target app has an
iframe shell, table layout, `ctl00$MainContent$txtMemberId` control names and no test IDs.
Measured on it: the login fields have **no accessible name at all** — role `textbox`, empty
name, with "User ID:" sitting beside them as a separate table cell. A system built only on
role+name could not log in. That is why `label_proximity` is load-bearing rather than
defensive, and why the adapter consults the DOM *only* to answer "what is this control
called?" when the platform will not say.

**Multi-tenant.** A capability binds to `appProfile.vendorApp` and a version range, not to
a tenant. `tenant: "base"` means tenant-agnostic. Three mechanisms let one artifact span
institutions running the same vendor product:

- **ranked strategies as aliases** — a descriptor lists "Member ID" first and "Member
  Number" second; the same artifact resolves on both tenants with the fallback logged
- **`nameMatch: "alias"`** with an explicit alias list for controls with real names
  ("Search" / "Find")
- **recovery rules for per-tenant interstitials** — Summit interposes an acceptable-use
  screen after login; the capability declares it as a recoverable condition, so the tenant
  that shows it recovers and the tenant that does not never triggers the rule

`tenantOverrides` carries what a base recording genuinely cannot know — where an
institution's install lives, and any label it has renamed since. `specializeForTenant()`
returns a new capability rather than mutating, so one loaded artifact serves every tenant
in a process, and aliases are *appended* to the ranked strategies rather than replacing
them. Deliberately narrow: an override changes the entry point and adds aliases, never the
steps, outcomes or policy. A tenant needing different behaviour is a fork worth reviewing.

**Demonstrated, not argued.** `cu.member.read_savings_balance`, recorded against First
Community, replayed against Summit: different host, "Member Number" for "Member ID",
"Find" for "Search", "Regular Savings" for "Savings Balance", swapped row order, and an
extra acceptable-use screen after sign-in. Result `success`, same outputs; `999999` still
returns `MEMBER_NOT_FOUND`. Committed as `evidence/08-replay-cross-tenant-summit`.

Its log is the point:

```
entryPoint: .../t/summit   tenant: summit
outcome_detected: ACKNOWLEDGEMENT_REQUIRED -> recover
resolution: "the Member ID field" -> strategy #1 (label_proximity, conf 0.7)
```

Nothing failed, but the run records that this tenant needed a fallback to resolve a
control. That is the drift signal in practice: a tenant whose runs start leaning on
fallbacks is drifting, visible well before anything breaks.

Drift detection falls out of the evidence rather than needing new machinery: every
resolution logs which strategy index and confidence it used. A tenant whose runs start
resolving via fallbacks is drifting, and that is visible before anything fails. The
specialisation path is `tenant: "<id>"` with a version bump, so a tenant override is a
reviewable artifact rather than a code branch.

**Not built:** an actual desktop adapter, and automated cross-tenant promotion (running every capability against every tenant on a schedule). The
abstractions do not preclude either.

---

## 5. Escalation & handoff

**Detecting stuck** is not heuristic — it is the union of conditions the system already
classifies: a policy verdict of `confirm` (a risky or irreversible step), a hard failure
whose outcome rule says escalate, or exhausted recovery. Each carries the capability, the
step, why it stopped, the live URL and a screenshot.

**The control lease** is the model. Exactly one party may act; automation holds it by
default. When a human takes over the run **parks** rather than terminating — terminating
would lose the session, which defeats the entire requirement. Mechanically the pause is an
un-awaited promise: the registry returns one, the executor awaits it as the result of its
escalation hook, and a human resolving the intervention resolves it. No polling loop, and
the browser context, cookies and position in the flow are untouched.

**Both sides are gated server-side.** Automation calls `beforeAction` before every action,
which awaits the lease. Operator input is checked with `assertHolder("operator")`
immediately before dispatch. The console disables its own controls, but that is a
courtesy — demonstrated directly, input sent before taking control is refused by the
server with `control is held by "automation"`.

**Taking control** is CDP `Page.startScreencast` for the view and `Input.dispatchMouseEvent`
/ `dispatchKeyEvent` for control, over one WebSocket. Operator input travels the *same*
CDP Input path the automation uses, so the handoff cannot drift from the behaviour of the
thing it is taking over from.

**Handing back** distinguishes two resolutions, because they mean different things to an
audit trail: `resume` (the human authorised it; automation performs the step) and
`step_completed` (the human did it themselves; automation skips it). Every transfer records
who and why.

Verified end to end: replay reaches `s9_confirm` on a capability that creates an account,
refuses to act on its own authority even though the capability is approved and eight prior
steps ran unattended, escalates; a named operator attaches to the live session, receives
screencast frames, is refused input until taking control, takes it, acts, approves; the run
resumes and completes, returning `reference: SA-4401`.

The console is a working surface, not a mock: an escalation queue, the live session with
its screencast canvas, a capability catalog with an invoke form generated from the
declared input schema, and a browsable evidence trail for every run. It carries a command
palette, keyboard navigation and an auto-refresh you can pause — an operator investigating
an incident needs the screen to hold still. A tool built on accessibility trees is also
keyboard-navigable and announces its own state changes, which felt like the minimum.

**Deliberately minimal:** operator identity is a string supplied by the caller. In
production it comes from the institution's SSO, because "who took control" has to name a
person. The field is threaded through every transfer so that substitution is local.

---

## 6. Safety

**Allowlist, enforced twice.** `PolicyEngine.check()` runs before every action — not once
at planning, because during discovery the model picks each action freshly and during
replay a page can redirect between steps. Non-navigation actions are validated against the
*current* URL, so a session that has drifted off-allowlist cannot keep clicking. Underneath
that, the browser context installs a network-level route filter from the same allowlist, so
even a page-initiated redirect cannot reach an off-list origin.

The allowlist is a literal-match language (origin, or `/*` prefix), not regex: allowlists
are security-relevant and a reviewer must be able to read one at a glance. Tests cover the
two ways naive implementations break — `/t/firstcu-evil` must not match the `/t/firstcu/*`
prefix, and `evil-127.0.0.1` must not match host `127.0.0.1`.

**Risk is classified at record time**, not inferred at replay. Combined with
`draft → approved`, the risk surface of a capability is fixed and reviewable before it can
ever run unattended — replay executes only recorded, approved steps, so no *new* risky
action can appear. That is a stronger guarantee than any runtime heuristic because it does
not depend on correctly classifying a novel action under time pressure. Steps at or above
`confirmAtOrAbove` require a human every time, regardless of approval state.

**Secrets never enter the model context.** The agent is told which secret *keys* exist and
emits `{{secret:corelink.password}}`; the executor substitutes at the moment of typing. The
password is absent from the prompt, the transcript and the artifact — not redacted
afterwards, never present.

**Redaction is applied on the write path**, inside the logger, not at call sites: a call
site that forgets is the expected case, so forgetting must be safe. Two independent
mechanisms, because either alone leaks — registered values (catching a password echoed back
in a form field) and structural patterns (SSN, Luhn-checked card numbers, API keys).
Declared field sensitivity governs the rest: `pii` keeps type and length (`[pii:string:6]`)
because that is genuinely useful when debugging; `secret` keeps nothing, because length
leaks. Screenshots mask sensitive fields at capture time, since an image cannot be scrubbed
afterwards.

**Limits, honestly.** Basic auth in front of the console is a floor, not an answer.
Pattern-based PII detection is best-effort and will miss unusual formats. The recorder's
risk heuristic is deliberately pessimistic but is still a heuristic — it is a prompt for
human review, not a guarantee, which is precisely why review is mandatory before approval.
And the network allowlist protects the automation's session, not the target application
itself.

---

## 7. Cuts

**Deliberately not built, with the seam left clean:**

- **Desktop adapter.** `Surface` is the seam and `SurfaceNode` is already the AX vocabulary.
  A UIA/AX implementation is real work but changes nothing above the line.
- **Automated outcome discovery.** A single happy-path run cannot know what the error
  states look like, so a discovered capability is always `draft` with an empty outcome
  table. This is visible in the evidence: the agent's own artifact replays cleanly for two
  different members but returns `CHECKPOINT_FAILED` on `999999`, where the hand-authored
  one returns `MEMBER_NOT_FOUND`. That gap *is* the review work, and it is exactly what the
  approval gate exists to force.
- **Turning a handoff into an amendment.** Human actions during an intervention are already
  recorded in the same shape as automation actions, so the obvious next step is proposing
  them as a patch to the capability. The data is captured; that specific flow is not built —
  though editing and re-approving a capability now is (see below).
- **Per-operator identity.** A string today; an SSO subject in production.
- **Generated API types.** The console mirrors the server contract by hand. Generating both
  from the same Zod schemas would remove a drift risk.
- **Multi-run stability scoring**, cross-tenant promotion tooling, and queueing. All of them
  are infrastructure the brief explicitly does not reward at this stage.

**What I would build next, in order:**

1. **Outcome authoring from evidence.** The manual half of this now exists: the console
   runs discovery, edits capabilities against the live schema, and approves them, and the
   compare view diffs a discovered draft against its reviewed version. Demonstrated
   end to end — the agent's draft returned `CHECKPOINT_FAILED` for a missing member, a
   reviewer added one outcome rule, and it returns `MEMBER_NOT_FOUND`; approving it then
   permits unattended invocation. What remains is the *suggestion* step: after a failed
   replay, offer the observed screen as a candidate outcome rule to name and classify,
   rather than making the reviewer write it. The failure evidence already contains
   everything needed.
2. **Cross-tenant verification.** Replay every capability against every tenant on a schedule
   and report which resolved via fallback strategies. Drift becomes a dashboard rather than
   an incident, and the data is already in the run logs.
3. **A desktop adapter**, to prove the seam rather than assert it.

**On the amount of UI.** The operator console is larger than a take-home strictly needs.
It exists because §3.6 requires a human to take control of a live session, and that is not
something a stub can demonstrate honestly — the screencast, the control lease and the
server-side input gate are the requirement, and they need a surface. The public site and
the catalog views grew from the same place. The load-bearing engineering is still the
schema, the replay engine and the control-transfer model; the UI is how those are made
inspectable.

**What I would change about what exists:** the `settle()` loop currently re-observes the
whole accessibility tree on every poll, which is wasteful on large pages; it should diff
cheaply first. And `deriveCheckpoint` picks a single marker string — a human reviewing a
draft would be better served by three candidates ranked by distinctiveness.
