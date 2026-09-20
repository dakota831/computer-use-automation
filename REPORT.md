# Design write-up

A record-once / replay-many computer-use system for legacy back-office applications. An
LLM drives a real UI to accomplish a goal once; the run becomes a typed, versioned
capability; that capability is replayed deterministically with no model in the loop.

Everything below was measured against a running system. `DECISIONS.md` carries the
long-form reasoning and the bugs that produced much of it; this is the summary, and it
stays at summary length deliberately.

---

## 1. Architecture

Single TypeScript package, boundaries enforced by the import graph rather than build
tooling: `core` imports nothing from `surface`, `replay` nothing from `agent`. A monorepo
would be the scaling infrastructure the brief penalises.

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
1.63 _removed_ `page.accessibility`, which forced an explicit perception layer rather than
a borrowed helper — better anyway.

TypeScript because the contract is the centrepiece: one Zod definition serves runtime
validation, static types, and (via `z.toJSONSchema()`) the tool schema a calling agent
consumes — three artifacts that cannot drift apart.

Model provider is NVIDIA NIM behind an OpenAI-compatible client, so model choice is
configuration — which mattered, because the first choice was wrong. Latency picked
`gpt-oss-20b` (775ms against `glm-5.3`'s 14s), and on a short lookup they are equivalent.
On a longer goal `gpt-oss-20b` took 18 steps and 23 calls where `glm-5.3` took 10 and 13,
and baked a mangled account number into the artifact. Discovery runs once and its artifact
is replayed indefinitely, so the measure is steps to a reviewable artifact, not seconds per
call; `glm-5.3` is the default. Because perception is text this needs no vision model,
which is what makes a free tier viable and a real cost argument in production.

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

**Targeting is a ranked strategy list, not a selector** — ordered, each with a confidence
and a written rationale: scoped role+name → normalized/aliased → label-proximity →
nth-of-role. CSS and XPath are in the schema but **never emitted**; they encode incidental
structure exactly where structure means least.

**Ambiguity is a halt.** Two matches stops the replay. Taking the first is how automation
quietly clicks the wrong control, and a confident wrong action in a bank back-office is
far worse than a clean stop.

**One assertion vocabulary** serves checkpoints, the success condition and outcome
detectors — one evaluator to get right, and it forces the point that detecting "no such
member" is the same kind of act as confirming success.

**Provenance stores a transcript hash, not the transcript**, which is large, full of
unredacted screen text, and would make the contract unreviewable.

The schema was validated by hand-authoring a capability against it before the agent
existed. Two things surfaced: ranked strategies double as the cross-tenant alias mechanism,
and `relation` on a label-proximity strategy must be _enforced_ — on a two-column layout
the cell right of "Name:" and the cell below it report identical adjacent text.

---

## 3. Determinism & error handling

Replay consults no model, and resolution is a pure function of (descriptor, observation),
so determinism is unit-testable without a browser. The result contract has four mutually
exclusive arms:

```
success    outputs, coerced to the declared types
outcome    a legitimate application answer: MEMBER_NOT_FOUND, PERMISSION_DENIED
escalated  interventionId, awaiting a human
failed     code, stepId, expected, observed, evidence paths
```

**A business outcome is not throwable.** `BusinessOutcome` is a plain type, not an `Error`
subclass, so the mistake the brief warns about is unrepresentable rather than discouraged.

**Outcome detectors are polled together with checkpoints.** After an action we wait until
the page is either where we expected or somewhere we explicitly know about, whichever comes
first. Checking outcomes once, immediately, samples the page mid-navigation — which is how a
clean `PERMISSION_DENIED` was first reported as an extraction failure three steps later
(D12). Recovery is bounded per rule with an eight-attempt ceiling per step, and resumes at
the _checkpoint_ rather than re-running the action.

Measured across the seeded states:

| input    | condition               | result                                                   |
| -------- | ----------------------- | -------------------------------------------------------- |
| `100001` | normal record           | `SUCCESS` `{savingsBalance: 8214.55, …}`                 |
| `200002` | unexpected interstitial | `SUCCESS` — dismissed and continued                      |
| `200003` | slow load (~6s)         | `SUCCESS` — waited it out                                |
| `999999` | no such member          | `OUTCOME MEMBER_NOT_FOUND`                               |
| `200001` | permission denied       | `OUTCOME PERMISSION_DENIED`                              |
| `12345`  | malformed input         | `FAILED INPUT_INVALID` in 1ms, before a browser launches |
| `200004` | application error       | `FAILED APP_ERROR @s5_search`                            |

**On UI drift**, the brief is right that these apps are stable, so ranked fallbacks plus
loud logging when a low-confidence strategy is reached is proportionate — drift shows up as
rising fallback usage before it shows up as failure.

That got tested by accident: the target was later restyled into something resembling real
institutional software and its navigation flow changed with it. **All 7 capabilities still
replayed, identical outcomes, no artifact edited.** "The textbox whose left-hand label reads
Member ID" is indifferent to a new header, palette and navigation model. A CSS selector or
a coordinate would have broken on any one of them.

---

## 4. Heterogeneity & multi-tenant

**Other surfaces.** The seam is `Surface` — `observe`, `resolve`, a small action set —
with `SurfaceNode` carrying role, name, value, container and frame path. A desktop adapter
implements the same interface over UIA or AX and the artifact does not change, because a
`role_name` or `label_proximity` descriptor means the same thing on a Windows control tree.
Remote viewing is a separate `RemoteControllable` capability, so a surface that cannot be
screencast degrades honestly rather than pretending.

Legacy web is demonstrated, not hypothetical: iframe shell, table layout,
`ctl00$MainContent$…` names, no test IDs. Measured on it, **the login fields have no
accessible name at all** — role+name alone could not sign in. That is why label-proximity is
load-bearing, and why the adapter consults the DOM _only_ to answer "what is this control
called?" when the platform will not say.

**Multi-tenant.** A capability binds to `appProfile.vendorApp`, not a tenant. Ranked
strategies absorb most variation — "Member ID" first, "Member Number" second resolves on
both installs. The rest lives in `tenantOverrides`, carrying only what a base recording
cannot know: where the install is, and any label renamed. Deliberately narrow: an override
cannot change steps, outcomes or policy, because a tenant needing different _behaviour_ is
a fork worth reviewing.

Demonstrated: `cu.member.read_savings_balance`, recorded against First Community, replayed
against Summit — different host, "Member Number", "Find", "Regular Savings", swapped rows,
an extra acceptable-use screen. `success`, same outputs, in
`evidence/08-replay-cross-tenant-summit`, whose log shows the acknowledgement recovered and
the member field resolving via **strategy #1** rather than the base label. Nothing failed,
but the run records which tenant needed a fallback — the drift signal working.

**Not built:** a desktop adapter, and scheduled cross-tenant verification.

---

## 5. Escalation & handoff

**Detecting stuck** is not heuristic: it is the union of a `confirm` policy verdict, an
escalate-disposition outcome, and exhausted recovery. The request carries capability, step,
reason, live URL and a screenshot.

**The control lease** is the model. One holder at a time, automation by default. When a
human takes over the run **parks** rather than terminating — the pause is an un-awaited
promise, so the browser context, cookies and position survive. Both sides are gated
server-side: automation awaits the lease before every action, operator input is checked
before dispatch. Taking control is CDP `Page.startScreencast` plus `Input.dispatch*` through
the same input path the automation uses, so the handoff cannot drift from what it takes over
from.

**Handing back** distinguishes `resume` (the human authorised it; automation acts) from
`step_completed` (the human acted; automation skips) — different things to an audit trail.
An unanswered escalation resolves to `abandon` after a bounded wait and returns the lease,
so a parked run cannot pin a session forever.

**Discovery escalates through the same registry.** It first refused every irreversible step,
on the grounds that discovery is unattended. True of the CLI, false of the console — and
refusing there does not make the system safer, it makes it unable to _learn_ the operations
that most deserve a reviewed capability around them. Time the human spends deciding is
credited back to the run's budget; charging deliberation to the agent's clock would punish
careful review.

Verified both ways. Replay: `evidence/09-replay-escalated-handoff` posts a fee, pausing at
both irreversible steps — on every run, because approval is not a gate passed once.
Discovery: an operator approved two such steps and the run resumed on the same session to
produce `cu.member.post_maintenance_fee`.

**Deliberately minimal:** operator identity is a caller-supplied string; in production an
SSO subject, since "who took control" must name a person. The field is threaded through
every transfer so that substitution is local.

---

## 6. Safety

**Allowlist, enforced twice.** Before _every_ action, and again at the network layer so a
page-initiated redirect cannot reach an off-list origin. Literal-match language, not regex,
because a reviewer must read it at a glance. Tests cover the two ways naive versions break:
`/t/firstcu-evil` must not match `/t/firstcu/*`, and `evil-127.0.0.1` must not match host
`127.0.0.1`.

**Risk is classified at record time**, not inferred at replay, so with `draft → approved`
the risk surface is fixed and reviewable before anything runs unattended — no _new_ risky
action can appear. A committing control inherits the consequence of the screen it commits:
judging by the control's own label alone gated the link _into_ a posting form and waved
through the `Confirm` that moved the money. Steps at or above `confirmAtOrAbove` ask a human
every time, approved or not.

**Secrets never enter the model context.** The agent emits `{{secret:corelink.password}}`;
the executor substitutes at typing time. The value is absent from the prompt, the transcript
and the artifact — not redacted afterwards, never present.

**The model key cannot be hashed**, and saying so is more useful than shipping something
that looks like it was: an outbound credential must be sent, so the process must be able to
read it. What is achievable is narrower. It is encrypted at rest under a key derived from the
machine id, so a copied file is inert elsewhere; it is out of `.env`, so out of the service's
`EnvironmentFile` and out of `/proc/<pid>/environ`; it is registered with the redactor, so it
cannot reach a log; and `npm run secret-scan` runs in `npm run check` and as a pre-commit
hook, because a key pushed to a public repo is the one mistake that cannot be undone. It does
_not_ stop anyone who can execute as the service user — necessarily. `src/core/secrets.ts` is
the seam a KMS or systemd `LoadCredential` slots into.

**Redaction runs on the write path**, inside the logger, because a call site that forgets is
the expected case. Two mechanisms, since either alone leaks: registered values and structural
patterns (SSN, Luhn-checked cards, API keys). Declared sensitivity governs the rest — `pii`
keeps type and length, `secret` keeps nothing, because length leaks. Screenshots mask at
capture, since an image cannot be scrubbed afterwards.

**Limits, honestly.** Basic auth on the console is a floor, not an answer. Pattern-based PII
detection is best-effort. The risk heuristic is pessimistic but still a heuristic — it
prompts review rather than replacing it. And the network allowlist protects the automation's
session, not the target application.

---

## 7. Cuts

**Not built, seam left clean:**

- **Desktop adapter.** `Surface` is the seam and `SurfaceNode` is already the AX vocabulary.
  Real work, but nothing above the line changes.
- **Automated outcome discovery.** One happy-path run cannot know the error states, so a
  discovered capability is always `draft` with an empty outcome table. Visible in the
  evidence: the agent's own artifact replays cleanly for two members but returns
  `CHECKPOINT_FAILED` on `999999`, where the reviewed version returns `MEMBER_NOT_FOUND`.
  That gap _is_ the review work — and the console now closes it by hand (below).
- **Handoff → amendment.** Human actions during an intervention are recorded in the same
  shape as automation actions, so proposing them as a patch is the obvious next step. The
  data is captured; that flow is not built.
- **Per-operator identity**, **generated API types**, **multi-run stability scoring**,
  **scheduled cross-tenant verification**. The last three are infrastructure the brief does
  not reward at this stage.
- **A real secret store.** The model key is sealed to the host (§6); a KMS or systemd
  `LoadCredential` belongs there, and `src/core/secrets.ts` is the seam.

**On the amount of UI.** §3.6 requires a human to take control of a live session, and a
stub cannot show that honestly — the screencast, the lease and the server-side input gate
_are_ the requirement and need a surface. The load-bearing engineering is still the schema,
the replay engine and the control-transfer model.

**What I would build next, in order:**

1. **Outcome authoring from evidence.** The manual half exists: the console runs discovery,
   edits capabilities against the live schema, approves them, and diffs a draft against its
   reviewed version. What remains is _suggestion_ — after a failed replay, offer the observed
   screen as a candidate outcome rule to name and classify. The evidence already holds
   everything needed.
2. **Cross-tenant verification on a schedule**, reporting which capabilities resolved via
   fallback strategies, so drift is a dashboard rather than an incident.
3. **A desktop adapter**, to prove the seam rather than assert it.

**What I would change about what exists:** the settle loop re-observes the whole
accessibility tree on every poll and should diff cheaply first; and `deriveCheckpoint` picks
a single marker string where a reviewer would be better served by three ranked candidates.
