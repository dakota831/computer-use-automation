# Design write-up

A record-once / replay-many computer-use system for legacy back-office applications. An
LLM drives a real UI to accomplish a goal once; the run becomes a typed, versioned
capability; that capability is replayed deterministically with no model in the loop.

Everything below was measured against a running system. `DECISIONS.md` carries the
long-form reasoning and the bugs that produced much of it; this is the summary.

---

## 1. Architecture

Single TypeScript package, boundaries enforced by the import graph rather than build
tooling. The brief penalises scaling infrastructure, and a monorepo here would be exactly
that — what matters is that `core` imports nothing from `surface` and `replay` imports
nothing from `agent`, which is free.

```
src/core/      capability schema, error taxonomy, policy, redaction, run log
src/surface/   Surface interface + CDP perception adapter   ← the portability seam
src/agent/     discovery loop, model client, recorder
src/replay/    executor, locator resolver, outcome detection
src/server/    control lease, escalation registry, catalog, authoring
web/           operator console + public site
target-app/    synthetic legacy surface, two tenants
```

**The load-bearing decision is the `Surface` seam.** Nothing above it imports Playwright
or CDP. Perception is the accessibility tree (`Accessibility.getFullAXTree`), not the DOM,
because role/name/value is the one vocabulary that also exists on Windows UI Automation
and macOS AX. Building on CSS would have made the desktop story in §4 fiction. Playwright
1.63 *removed* `page.accessibility`, which forced an explicit perception layer rather than
a borrowed helper — better anyway.

TypeScript because the contract is the centrepiece: Zod gives one definition serving
runtime validation, static types, and (via `z.toJSONSchema()`) the tool schema a calling
agent consumes. Three artifacts that cannot drift apart.

Model provider is NVIDIA NIM behind an OpenAI-compatible client, so model choice is
configuration. Measured tool-calling latency picked the default: `gpt-oss-20b` 775ms
against `glm-5.3` 14s and `kimi-k3` 120s — all correct, the spread decisive at ~10 calls
per run. Because perception is text, this needs no vision model, which is what makes a
free tier viable and is a real cost argument in production.

---

## 2. Artifact schema

A capability is a **contract**, not a step list. Inputs, outputs, outcomes and the success
condition are declared at the top level, so a caller or reviewer sees what it needs and
returns without reading a step.

```
Capability
  id, version (semver), status: draft | approved | deprecated
  surface  { entryPoint, appProfile { vendorApp, versionRange } }
  tenant, tenantOverrides
  inputs   ParamSpec[]   name, type, required, pattern, sensitivity
  outputs  OutputSpec[]  source: TargetDescriptor, transform[]
  steps    Step[]        intent, action, riskClass, checkpoint, outcomes[]
  successCondition, outcomes[], policy, provenance
```

Four decisions worth defending:

**Targeting is a ranked strategy list, not a selector.** Each descriptor carries ordered
strategies with a confidence and a written rationale: scoped role+name → normalized/aliased
→ label-proximity → nth-of-role. CSS and XPath are supported by the schema but **never
emitted** — they encode incidental structure precisely where structure is least meaningful.

**Ambiguity is a halt.** If a strategy matches two nodes, replay stops. Taking the first is
how automation quietly clicks the wrong control, and a confident wrong action in a banking
back-office is far worse than a clean stop.

**One assertion vocabulary** serves checkpoints, the success condition and outcome
detectors. One evaluator to get right, and it forces the point that detecting "no such
member" is the same kind of act as confirming success.

**Provenance stores a transcript hash, not the transcript.** The transcript is evidence:
large, full of unredacted screen text, and coupling the contract to it would make the
artifact unreviewable.

The schema was validated by hand-authoring a capability against it before the agent
existed. Two things surfaced that way: ranked strategies double as the cross-tenant alias
mechanism, and `relation` on a label-proximity strategy must be *enforced* — on a
two-column layout the cell right of "Name:" and the cell below it report identical
adjacent text.

---

## 3. Determinism & error handling

Replay consults no model. Resolution is a pure function of (descriptor, observation), so
the determinism story is unit-testable without a browser.

The result contract has four mutually exclusive arms:

```
success    outputs, coerced to the declared types
outcome    a legitimate application answer: MEMBER_NOT_FOUND, PERMISSION_DENIED
escalated  interventionId, awaiting a human
failed     code, stepId, expected, observed, evidence paths
```

**A business outcome is not throwable.** `BusinessOutcome` is a plain type, not an `Error`
subclass, so the mistake the brief warns about is unrepresentable rather than discouraged.
The CLI carries it to exit codes: outcome 0, failure 1.

**Outcome detectors are polled together with checkpoints.** After an action we wait until
the page is either where we expected or somewhere we explicitly know about, whichever comes
first. Checking outcomes once, immediately, samples the page mid-navigation — which is how
a clean `PERMISSION_DENIED` was originally reported as an extraction failure three steps
later (D12). Recovery is bounded per rule, with an absolute eight-attempt ceiling per step,
and resumes at the *checkpoint* rather than re-running the action.

Measured across the seeded states:

| input | condition | result |
|---|---|---|
| `100001` | normal record | `SUCCESS` `{savingsBalance: 8214.55, …}` |
| `200002` | unexpected interstitial | `SUCCESS` — dismissed and continued |
| `200003` | slow load (~6s) | `SUCCESS` — waited it out |
| `999999` | no such member | `OUTCOME MEMBER_NOT_FOUND` |
| `200001` | permission denied | `OUTCOME PERMISSION_DENIED` |
| `12345` | malformed input | `FAILED INPUT_INVALID` in 1ms, before a browser launches |
| `200004` | application error | `FAILED APP_ERROR @s5_search` |

**On UI drift**, the brief is right that these apps are stable, so ranked fallbacks plus
loud logging when a low-confidence strategy is reached is proportionate — drift shows up as
rising fallback usage before it shows up as failure.

That got tested by accident. Late on, the target application was restyled from a bare page
into something that looks like real institutional software, and the navigation flow changed
with it — signing in became a full top-frame transition. **Every recorded capability still
replayed: 7/7, identical outcomes, no artifact edited.** A descriptor saying "the textbox
whose left-hand label reads Member ID" is indifferent to a new header, a new palette and a
different navigation model. A CSS selector or a coordinate would have broken on any one.

---

## 4. Heterogeneity & multi-tenant

**Other surfaces.** The seam is `Surface` — `observe`, `resolve`, a small action set, with
`SurfaceNode` carrying role, name, value, container and frame path. A desktop adapter
implements the same interface over UIA or AX; the recorded artifact does not change, because
a `role_name` or `label_proximity` descriptor means the same thing on a Windows control tree.
Remote viewing is a separate `RemoteControllable` capability, so a surface that cannot be
screencast degrades honestly instead of pretending.

Legacy web is the demonstrated case, not a hypothetical: iframe shell, table layout,
`ctl00$MainContent$…` names, no test IDs. Measured on it, **the login fields have no
accessible name at all** — a system built only on role+name could not sign in. That is why
label-proximity is load-bearing, and why the adapter consults the DOM *only* to answer "what
is this control called?" when the platform will not say.

**Multi-tenant.** A capability binds to `appProfile.vendorApp`, not a tenant. Most variation
is absorbed by ranked strategies — "Member ID" first, "Member Number" second resolves on
both installs. What is left lives in `tenantOverrides`, which carries only what a base
recording cannot know: where this institution's install is, and any label it has renamed.
Deliberately narrow — an override cannot change steps, outcomes or policy. A tenant needing
different *behaviour* is a fork worth reviewing.

Demonstrated, not argued: `cu.member.read_savings_balance`, recorded against First Community,
replayed against Summit — different host, "Member Number", "Find", "Regular Savings",
swapped row order, and an extra acceptable-use screen. Result `success`, same outputs.
Committed as `evidence/08-replay-cross-tenant-summit`, whose log shows the acknowledgement
being recovered and the member field resolving via **strategy #1** rather than the base
label. Nothing failed, but the run records which tenant needed a fallback — that is the
drift signal working.

**Not built:** a desktop adapter, and scheduled cross-tenant verification.

---

## 5. Escalation & handoff

**Detecting stuck** is not heuristic: it is the union of a `confirm` policy verdict, an
escalate-disposition outcome, and exhausted recovery. The request carries capability, step,
reason, live URL and a screenshot.

**The control lease** is the model. One holder at a time; automation holds it by default.
When a human takes over the run **parks** rather than terminating — the pause is an
un-awaited promise, so the browser context, cookies and position survive. Terminating would
lose the session, which defeats the requirement.

Both sides are gated **server-side**. Automation awaits the lease before every action;
operator input is checked immediately before dispatch. The console disables its own controls,
but that is a courtesy — demonstrated directly, input sent before taking control is refused
with `control is held by "automation"`.

Taking control is CDP `Page.startScreencast` plus `Input.dispatch*` over one WebSocket, through
the same input path the automation uses, so the handoff cannot drift from the behaviour it is
taking over from.

**Handing back** distinguishes `resume` (the human authorised it; automation acts) from
`step_completed` (the human acted; automation skips). Different things to an audit trail.
An escalation nobody answers resolves to `abandon` after a bounded wait and returns the
lease, so a parked run cannot pin a session forever.

Verified end to end: replay reaches `s9_confirm`, refuses to create an account on its own
authority though the capability is approved and eight prior steps ran unattended, escalates;
a named operator attaches, is refused input until taking control, takes it, approves; the run
resumes and returns `reference: SA-4401`.

**Deliberately minimal:** operator identity is a caller-supplied string. In production it is
an SSO subject, because "who took control" must name a person. The field is threaded through
every transfer so that substitution is local.

---

## 6. Safety

**Allowlist, enforced twice.** Checked before *every* action — during discovery the model
picks each action freshly; during replay a page can redirect between steps — and again at the
network layer, so a page-initiated redirect cannot reach an off-list origin. It is a
literal-match language, not regex, because a reviewer must read it at a glance. Tests cover
the two ways naive versions break: `/t/firstcu-evil` must not match `/t/firstcu/*`, and
`evil-127.0.0.1` must not match host `127.0.0.1`.

**Risk is classified at record time**, not inferred at replay. With `draft → approved`, the
risk surface is fixed and reviewable before anything runs unattended — replay executes only
recorded, approved steps, so no *new* risky action can appear. Stronger than a runtime
heuristic, because it does not depend on classifying a novel action under time pressure.
Discovery gates with the same shared heuristic; steps at or above `confirmAtOrAbove` require
a human every time regardless of approval.

**Secrets never enter the model context.** The agent emits `{{secret:corelink.password}}` and
the executor substitutes at typing time. The password is absent from the prompt, the
transcript and the artifact — not redacted afterwards, never present.

**Redaction runs on the write path**, inside the logger, because a call site that forgets is
the expected case. Two mechanisms, since either alone leaks: registered values (a password
echoed back in a form field) and structural patterns (SSN, Luhn-checked cards, API keys).
Declared sensitivity governs the rest — `pii` keeps type and length, `secret` keeps nothing,
because length leaks. Screenshots mask sensitive fields at capture, since an image cannot be
scrubbed afterwards.

**Limits, honestly.** Basic auth in front of the console is a floor, not an answer.
Pattern-based PII detection is best-effort. The risk heuristic is pessimistic but still a
heuristic — it prompts review rather than replacing it, which is why review is mandatory
before approval. And the network allowlist protects the automation's session, not the target
application.

---

## 7. Cuts

**Not built, seam left clean:**

- **Desktop adapter.** `Surface` is the seam and `SurfaceNode` is already the AX vocabulary.
  Real work, but nothing above the line changes.
- **Automated outcome discovery.** One happy-path run cannot know the error states, so a
  discovered capability is always `draft` with an empty outcome table. Visible in the
  evidence: the agent's own artifact replays cleanly for two members but returns
  `CHECKPOINT_FAILED` on `999999`, where the reviewed version returns `MEMBER_NOT_FOUND`.
  That gap *is* the review work — and the console now closes it by hand (below).
- **Handoff → amendment.** Human actions during an intervention are recorded in the same
  shape as automation actions, so proposing them as a patch is the obvious next step. The
  data is captured; that flow is not built.
- **Per-operator identity**, **generated API types**, **multi-run stability scoring**,
  **scheduled cross-tenant verification**. The last three are infrastructure the brief does
  not reward at this stage.

**On the amount of UI.** The console is larger than a take-home strictly needs. It exists
because §3.6 requires a human to take control of a live session, and a stub cannot
demonstrate that honestly — the screencast, the lease and the server-side input gate *are*
the requirement and need a surface. The load-bearing engineering is still the schema, the
replay engine and the control-transfer model; the UI is how those are made inspectable.

**What I would build next, in order:**

1. **Outcome authoring from evidence.** The manual half exists — the console runs discovery,
   edits capabilities against the live schema, approves them, and diffs a draft against its
   reviewed version. What remains is the *suggestion* step: after a failed replay, offer the
   observed screen as a candidate outcome rule to name and classify. The failure evidence
   already contains everything needed.
2. **Cross-tenant verification on a schedule**, reporting which capabilities resolved via
   fallback strategies. Drift becomes a dashboard rather than an incident; the data is
   already in the run logs.
3. **A desktop adapter**, to prove the seam rather than assert it.

**What I would change about what exists:** the settle loop re-observes the whole
accessibility tree on every poll, which is wasteful on large pages and should diff cheaply
first. And `deriveCheckpoint` picks a single marker string — a reviewer would be better
served by three candidates ranked by distinctiveness.
