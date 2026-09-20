# Decision log

Running notes, newest last. Each entry: what was decided, the alternative, and why.
This is the raw material for REPORT.md — it exists so the reasoning is captured at
the moment of the decision rather than reconstructed afterwards.

---

## Index

Newest entries are at the bottom of the file; this index groups them by subject.

**Foundations**  
[D1](#d1--typescript-single-package) typescript, single package  ·  [D2](#d2--perception-is-the-accessibility-tree-over-cdp-not-the-dom) perception is the accessibility tree over cdp, not the dom  ·  [D3](#d3--nvidia-nim-as-the-model-provider) nvidia nim as the model provider

**The artifact and how controls are found**  
[D4](#d4--locator-strategies-are-ranked-and-ambiguity-is-a-failure) locator strategies are ranked, and ambiguity is a failure  ·  [D5](#d5--one-assertion-vocabulary-for-checkpoints-success-and-error-detection) one assertion vocabulary for checkpoints, success, and error detection  ·  [D11](#d11--the-surface-seam-and-a-bug-that-proves-why-geometry-is-not-a-locator) the surface seam, and a bug that proves why geometry is not a locator  ·  [D21](#d21--visual-realism-and-machine-hostility-are-independent-axes) visual realism and machine hostility are independent axes

**Replay, errors and determinism**  
[D9](#d9--a-business-outcome-is-not-throwable) a business outcome is not throwable  ·  [D12](#d12--after-an-action-wait-for-a-recognised-state-not-just-the-expected-one) after an action, wait for a *recognised* state, not just the expected one  ·  [D32](#d32--the-session-clock-became-a-checkpoint) the session clock became a checkpoint

**Safety and risk**  
[D6](#d6--risk-is-classified-at-record-time-not-replay-time) risk is classified at record time, not replay time  ·  [D8](#d8--redaction-happens-on-the-write-path-not-at-call-sites) redaction happens on the write path, not at call sites  ·  [D10](#d10--policy-is-checked-before-every-action-and-enforced-twice) policy is checked before every action, and enforced twice  ·  [D14](#d14--the-model-never-sees-a-credential) the model never sees a credential  ·  [D31](#d31--what-a-line-by-line-review-turned-up) what a line-by-line review turned up

**Discovery and the review loop**  
[D15](#d15--a-discovered-capability-is-always-a-draft) a discovered capability is always a draft  ·  [D16](#d16--two-recorder-bugs-the-first-real-run-exposed) two recorder bugs the first real run exposed  ·  [D17](#d17--provider-quirks-belong-at-the-adapter-boundary) provider quirks belong at the adapter boundary  ·  [D26](#d26--making-the-nav-real-broke-the-agent-and-that-was-worth-knowing) making the nav real broke the agent, and that was worth knowing  ·  [D28](#d28--the-review-loop-is-operable-which-is-what-makes-the-draft-gate-real) the review loop is operable, which is what makes the draft gate real  ·  [D34](#d34--two-gaps-the-brief-caught-that-i-had-not) two gaps the brief caught that i had not

**Escalation and control transfer**  
[D18](#d18--the-control-lease-and-why-automation-parks-rather-than-stops) the control lease, and why automation parks rather than stops  ·  [D19](#d19--approving-a-risky-step-is-not-the-same-as-doing-it) approving a risky step is not the same as doing it  ·  [D24](#d24--an-escalation-nobody-answers-needs-a-bounded-outcome) an escalation nobody answers needs a bounded outcome

**Multi-tenant**  
[D25](#d25--cross-tenant-reuse-demonstrated-rather-than-argued) cross-tenant reuse, demonstrated rather than argued

**Interface and operations**  
[D20](#d20--reversing-d-nothing-the-console-needed-a-real-router) reversing d-nothing: the console needed a real router  ·  [D22](#d22--one-theme) one theme  ·  [D23](#d23--the-mobile-overflow-was-a-flexgrid-default-not-a-styling-mistake) the mobile overflow was a flex/grid default, not a styling mistake  ·  [D29](#d29--jump-to-next-anomaly-and-comparing-capabilities) jump-to-next-anomaly, and comparing capabilities  ·  [D30](#d30--min-width-auto-cost-me-four-attempts-so-here-is-the-rule) `min-width: auto` cost me four attempts, so here is the rule  ·  [D33](#d33--not-secure-was-never-the-certificate) "not secure" was never the certificate  ·  [D35](#d35--a-shared-footer-with-relative-links-pointed-at-the-wrong-site) a shared footer with relative links pointed at the wrong site  ·  [D36](#d36--dead-and-mis-named-npm-scripts) dead and mis-named npm scripts

**Measurements and mistakes worth keeping**  
[D7](#d7--measured-against-the-real-target-app-not-assumed) measured against the real target app, not assumed  ·  [D13](#d13--two-silent-patch-failures-and-what-they-cost) two silent patch failures, and what they cost  ·  [D27](#d27--the-evidence-generator-deleted-the-evidence-it-was-meant-to-protect) the evidence generator deleted the evidence it was meant to protect

**Also**  
[D37](#d37--documentation-is-checked-not-proofread) documentation is checked, not proofread  ·  [D38](#d38--reportmd-was-twice-the-length-the-brief-asked-for) report.md was twice the length the brief asked for

---

## D1 — TypeScript, single package

Single npm package with enforced module boundaries under `src/`, not a monorepo.

The brief is explicit that it does not reward scaling infrastructure, and a monorepo
would be exactly that: build tooling in place of judgment. Boundaries are enforced by
the import graph (`core` imports nothing from `surface`, `replay` imports nothing from
`agent`), which is the property that actually matters, and it is free.

TypeScript over Python because the artifact contract is the centrepiece: Zod gives one
source of truth that serves runtime validation, static types, and — via Zod 4's native
`z.toJSONSchema()` — the tool schema a calling agent consumes. In Python that is three
separate artifacts that drift apart.

## D2 — Perception is the accessibility tree over CDP, not the DOM

Verified during setup: `page.accessibility` was **removed** in Playwright 1.63, not
merely deprecated. The replacement is a CDP session and `Accessibility.getFullAXTree`.

This turned out to be the better answer anyway. The accessibility tree is the only
perception vocabulary that transfers across surfaces: the same role/name/value model
backs the web (CDP), Windows (UI Automation) and macOS (AX API). Building on the DOM
would have made the desktop story in brief §3.7 fiction.

Two limits measured on a real page during setup, both now designed for rather than
discovered late:
  - an unlabeled `<input>` in a table cell does **not** appear in the AX tree with a
    name, though its label cell does → hence the `label_proximity` locator strategy
  - `getFullAXTree` does not cross into iframes on its own → hence `framePath` on every
    target descriptor, resolved with per-frame CDP sessions

Screenshots are captured as evidence and for the human handoff, never as a primary
locator. Coordinates convert a layout shift into a silent misclick.

## D3 — NVIDIA NIM as the model provider

User's call. Written against the OpenAI-compatible interface NVIDIA exposes at
`integrate.api.nvidia.com/v1`, so provider and model are configuration, not code.

Free-tier models vary in tool-calling reliability and the discovery loop depends on it
entirely, so the client is deliberately swappable and the loop validates every tool call
against the Zod action schema before executing it — a malformed call from a weaker model
becomes a retry with a validation message, not a crash or a wrong click.

Worth noting: because perception is the AX tree (text) rather than screenshots, this
needs a *text* model, not a vision model. That is what makes a free tier viable at all,
and it is a genuine cost argument for the production system, not just for this exercise.

## D4 — Locator strategies are ranked, and ambiguity is a failure

Every target carries an ordered list of strategies with a confidence and a written
rationale, resolved in order at replay: scoped role+name → normalized/aliased name →
label proximity → nth-of-role → CSS/XPath (recorded, low-trust, logged loudly when used).

The deliberate choice is `ambiguityPolicy: "fail"` as the default. If a strategy matches
two nodes, replay stops. The tempting alternative — take the first match — is how an
automation quietly clicks the wrong button, and in a back-office banking context a
confident wrong action is far worse than a clean halt.

## D5 — One assertion vocabulary for checkpoints, success, and error detection

The same `Assertion` type expresses "did this step land", "did the capability succeed",
and "is this the record-not-found screen". One evaluator to get right, one concept for a
reviewer to learn, and it forces the point that detecting a business outcome is the same
kind of act as confirming success — which is precisely the distinction the brief warns
against collapsing.

Assertions are non-recursive; a checkpoint is a flat AND-list. Nested boolean trees would
be more expressive and much harder to review, and review is the point.

## D6 — Risk is classified at record time, not replay time

Each step carries `riskClass`. Combined with `status: draft | approved`, this means the
risk surface of a capability is fixed and reviewable *before* it is ever allowed to run
unattended — replay can only ever execute steps that were recorded and approved earlier.
That is a stronger guarantee than any runtime heuristic, because it does not depend on
correctly classifying a novel action under time pressure.

## D7 — Measured against the real target app, not assumed

Probed the accessibility tree against the stand-in app before writing the resolver.
Three findings, all of which the schema already anticipated — recording them because
they are the empirical justification for D2 and D4, not just an argument:

1. **The top-level AX tree stops at the iframe boundary.** `Accessibility.getFullAXTree`
   on the page returns 10 nodes: the shell chrome and nothing else. The working
   content is invisible from the top frame.

2. **Frame ids must come from `Page.getFrameTree`.** Playwright's internal frame handle
   is not a CDP frame id. Passing it silently returns the *top* frame's tree again
   rather than erroring — a quiet wrong answer, which is the failure mode this whole
   project is about. With real ids, the inner frame yields 34 nodes.

3. **The login fields have no accessible name at all.** The inner frame exposes two
   nodes of role `textbox` with empty names, while "User ID:" and "Password:" exist
   as separate `LayoutTableCell` nodes beside them. Role+name targeting *cannot*
   address these controls.

Finding 3 is the one that matters. It is the exact legacy pathology the brief describes,
reproduced without contrivance — it falls out of ordinary table markup with no
`<label for>`. It means `label_proximity` is not a defensive extra in the locator
ranking, it is the only strategy that can target the most important controls on the
page. A system that only did role+name would be unable to log in.

## D8 — Redaction happens on the write path, not at call sites

`RunLogger` passes everything through `Redactor.deep()` before it touches disk.
The alternative — redact at each call site — fails the moment one call site forgets,
and forgetting is the expected case across hundreds of log statements.

Two independent mechanisms, because either alone leaks. Registered values catch a
password echoed back in a form value or an error string, which no pattern would spot.
Patterns catch regulated data nobody declared, which is most of what a member record
screen contains. Card detection is Luhn-checked so 16-digit internal reference numbers
survive: over-redaction destroys the debuggability that evidence exists to provide.

`pii` keeps type and length (`[pii:string:6]`) because that is genuinely useful when
debugging. `secret` keeps nothing at all — length leaks information about a password.

## D9 — A business outcome is not throwable

`BusinessOutcome` is a plain type, not an `Error` subclass. "No such member" cannot be
`throw`n, so the most common design mistake in this problem is unrepresentable rather
than merely discouraged. Escalation is deliberately not a fourth kind of result either:
it is a *response* to a hard failure or a risky step, which keeps "what happened"
separate from "what we decided to do about it".

## D10 — Policy is checked before every action, and enforced twice

A plan approved up front says nothing about what the next action will be: during
discovery the model picks each action freshly, and during replay a page can redirect
between steps. So `PolicyEngine.check()` runs per action, and non-navigation actions are
validated against the *current* URL — a session that has drifted off-allowlist cannot
keep clicking.

The allowlist is a literal-match language (origin, or `/*` prefix), not regex.
Allowlists are security-relevant and a reviewer has to be able to read one at a glance.
Tests cover the two ways naive implementations break: `/t/firstcu-evil` must not match
the `/t/firstcu/*` prefix, and `evil-127.0.0.1` must not match host `127.0.0.1`.

The asymmetry between modes is the real decision. Discovery pauses for a human on a
risky action because a model chose it and nobody reviewed it. Replay cannot introduce a
new risky action at all — it executes only recorded, approved steps — so the risk surface
was fixed and reviewed before it ever ran unattended.

## D11 — The surface seam, and a bug that proves why geometry is not a locator

`src/surface/types.ts` defines what a surface owes its caller: `observe`, `resolve`,
and a small set of actions. Nothing above that line imports Playwright or CDP. A
desktop adapter implements the same interface, because role/name/value is exactly what
UI Automation and the AX API expose.

The web adapter keeps the accessibility tree as the source of truth for structure and
roles, and consults the DOM only to answer "what is this control called?" when the
platform declines to say. Order of preference, which encodes what is actually
trustworthy on legacy markup: associated `<label>` → the table cell to the left → the
cell above → placeholder/title → the generated `name` attribute. Verified against the
real app: the login textboxes have no accessible name and resolve as "User ID:" and
"Password:" purely from the adjacent cells.

Actions dispatch real input events (`Input.dispatchMouseEvent`) at the control's
coordinates rather than calling `element.click()`. That is honest to the "computer use"
framing, and it means the human handoff forwards input through exactly the same path the
automation uses — one code path, tested twice.

**The bug worth recording.** The first implementation computed each frame's viewport
offset with `Runtime.evaluate` in the top frame, so iframe content got offset `{0,0}`.
Every click inside the frame landed ~37px high, into the tenant's title bar. Nothing
errored. The form simply did not submit, and the run looked like a mysterious "login
didn't work". Fixed by walking the frame chain with `DOM.getFrameOwner` and adding each
owning iframe's position plus its border.

This is the same class of failure as taking the first of two ambiguous matches: the
system does something confidently wrong and reports nothing. It is the strongest
argument in this codebase for why coordinates are recorded as evidence only and never
used as a locator — a descriptor that resolves by role and label would have been
unaffected by the offset bug, because it never needed to know where anything was.

## D12 — After an action, wait for a *recognised* state, not just the expected one

The first replay loop checked the outcome detectors once, immediately after acting, and
then polled only the checkpoint. That is wrong, and the target app exposed it:

A click that submits a form starts a navigation, so observing straight afterwards
samples the *old* page. For member 200001 the permission-denied screen was therefore
never detected. Worse, that screen reuses the "Member Detail" panel title, so the
checkpoint later matched, every step "passed", and the run died at the very end with
"could not extract declared outputs" — a legitimate business outcome reported as an
extraction bug, three steps away from the actual cause.

Outcomes and checkpoints are now polled *together* in one `settle()` loop: after every
action we wait until the page is either where we expected to be, or somewhere we
explicitly know about, whichever comes first. Timing out means neither, which is a real
failure worth surfacing.

Two things fell out of this beyond correctness. Runs got roughly five times faster
(13s → 2.5s for the error cases), because the loop now exits the moment a state is
recognised instead of waiting out a full timeout before checking. And steps with no
checkpoint still settle briefly, because "nothing to verify" is not the same as
"nothing can go wrong".

## D13 — Two silent patch failures, and what they cost

Worth recording because it shaped how the rest of this was built. Two edits to
`resolve.ts` were applied with Python `str.replace`, whose search strings no longer
matched after formatting. `str.replace` is a no-op on a miss, and the scripts printed
success unconditionally — so two changes were reported as landed when neither had.

The visible symptom was output extraction failing for reasons that made no sense given
the code I believed was running. Every subsequent patch asserts on the result and fails
loudly instead of reporting success it has not verified. The parallel to the system
being built is not lost on me: an operation that silently does nothing and reports
success is the exact failure mode the ambiguity policy and the checkpoints exist to
prevent.

## D14 — The model never sees a credential

The agent is told which secret *keys* exist and emits `{{secret:corelink.password}}`;
the loop substitutes the value at the moment of typing. So the password is absent from
the prompt, from the transcript, and from the artifact — not redacted after the fact,
never present. The same template is what replay resolves later, so one mechanism serves
discovery and production.

## D15 — A discovered capability is always a draft

The recorder emits `status: "draft"`, never `approved`, and this is a correctness claim
rather than caution. One successful run proves the happy path. It cannot know what the
*error* states look like, because it never saw one.

The evidence is direct. The agent's own artifact replays cleanly for member 100001 and
100003, and on 999999 it returns `CHECKPOINT_FAILED` — technically true, but useless to a
caller. The hand-authored baseline returns `MEMBER_NOT_FOUND`, because a human wrote the
outcome table. That gap *is* the review work, and it is exactly what the draft → approved
gate exists to force. A capability that has never been reviewed cannot run unattended.

## D16 — Two recorder bugs the first real run exposed

Both were found by inspecting the artifact the agent produced, and neither would have
surfaced from a passing test.

**A secret in a checkpoint.** `deriveCheckpoint` picked "text that appeared" as its
marker, and after typing the username that text was `teller1`. Two distinct failures in
one line: a credential written into an artifact destined for source control, and — more
insidious — a checkpoint containing a run-specific value, which silently turns a reusable
capability into a single-use script. Nothing errors; the next caller with a different
member ID just gets an inexplicable `CHECKPOINT_FAILED`. Secrets and parameter values are
now both excluded from checkpoint text.

**An empty success condition.** Deriving it by diffing the final screen against the one
immediately before found nothing changed, yielding `all: []` — which `waitForCheckpoint`
satisfies trivially, so every replay would have reported success while verifying nothing.
It is now derived against the *first* observation of the run ("what is true at the end
that was not true at the start"), and an empty result is a hard error: the recorder
refuses to emit a capability that would claim success without checking anything.

## D17 — Provider quirks belong at the adapter boundary

`openai/gpt-oss-20b` on NIM leaks its Harmony response format into the function name, so
`click` arrives as `click<|channel|>commentary`. The model was choosing correctly; the
wire format was noisy. Before normalising this the agent burned all 22 steps retrying.

Normalisation lives in `tools.ts` at the provider boundary, not in the loop, so swapping
models does not move the workaround around. This is the concrete argument for D3's
provider-agnostic client: the abstraction earned its keep within an hour of first use.

## D18 — The control lease, and why automation parks rather than stops

Exactly one party may act on a session at a time, and the lease is the single
authoritative answer to "who". Automation holds it by default. When a human takes over,
the run does not terminate — it *parks*, awaiting the lease. Terminating would lose the
session, which defeats the requirement: the human has to operate the same live session
and hand it back so the run continues from where it stopped.

Mechanically the pause is just an un-awaited promise. `raise()` returns one, the executor
awaits it as the result of its escalation hook, and a human resolving the intervention
resolves it. No polling loop, no separate state machine, and the browser context, its
cookies and its position in the flow are untouched throughout.

Both sides are gated, and both gates are server-side:

  - automation calls `beforeAction` before every action, which awaits the lease
  - operator input is checked with `assertHolder("operator")` immediately before it is
    dispatched into the page

The console also disables its own controls, but that is a courtesy. Demonstrated
directly: operator input sent *before* taking control is refused by the server with
`control is held by "automation"`. A client that ignores the UI still cannot act.

Operator input goes through the same CDP Input domain the automation uses, so the
handoff cannot drift from the behaviour of the thing it is taking over from — one code
path, exercised by both.

## D19 — Approving a risky step is not the same as doing it

Two distinct resolutions, because they mean different things to the audit trail:

  `resume`         the human authorised it; automation performs the step
  `step_completed` the human performed it themselves; automation skips it

The first is what the irreversible-step gate is for. Replay reaches `s9_confirm`, refuses
to create an account on its own authority even though the capability is approved and
every prior step ran unattended, and asks. On approval it performs the click itself. The
human decided; the machine acted. That distinction is exactly what an auditor needs, and
collapsing the two would lose it.

Recorded human actions log key *names*, never typed characters — an operator entering a
member ID or a credential must not have it captured in an audit log.

## D20 — Reversing D-nothing: the console needed a real router

Earlier I argued a 15-line hash router was enough, because the console had three views
and one deep link that mattered. At eight routes with parameters that stopped being true,
so `react-router` is in. Recording the reversal rather than quietly swapping it: the
original reasoning was sound for three views and simply stopped applying, which is the
normal way a dependency earns its place.

## D21 — Visual realism and machine hostility are independent axes

The target application was restyled into something that looks like genuine institutional
software: a per-tenant crest, a branded header, a menu bar, a breadcrumb, a session clock,
a status bar naming the app server, and a full footer. Real bank back-office systems are
not sparse — they are dense and heavily chromed — so a stripped-down page was an
unrealistic target, not a neutral one.

None of the properties that make it a *useful* target changed: content still lives inside
an iframe, forms still lay out with nested tables, controls still carry generated
`ctl00$MainContent$` names, and there are still no test IDs and no `<label for>`
anywhere. The login fields still have no accessible name at all.

**The unplanned experiment.** The restyle also changed the navigation flow — signing in is
now a full top-frame transition rather than an in-frame redirect. Every recorded
capability still replayed correctly afterwards: 7/7 scenarios, same outcomes.

That is the locator thesis tested rather than asserted. A descriptor that says "the
textbox whose left-hand label reads Member ID" is indifferent to a new header, a changed
palette, an added menu bar and a different navigation model. A CSS selector or a
coordinate would have broken on any one of them.

One constraint the chrome had to respect: assertions match against all visible text,
shell included. Menu labels are deliberately chosen not to collide with any checkpoint
string ("Members", not "Member Search") — otherwise a nav item would make a checkpoint
pass on every screen in the application. That is a real coupling between the app's chrome
and the capabilities recorded against it, and it is worth knowing about.

## D22 — One theme

The light/dark toggle is gone. This is meant to read as institutional back-office
software, and a theme switcher is a developer-tool affordance that undercut that. It also
doubled the surface area every screen had to be checked against for no operational
benefit.

## D23 — The mobile overflow was a flex/grid default, not a styling mistake

Two console pages overflowed horizontally at 390px. The cause was not a wide element but
`min-width: auto`, which flex and grid children default to: they refuse to shrink below
their content, so a scrollable table or a `<pre>` pushes the entire page wide and the
`overflow-x-auto` that was supposed to contain it never engages.

Fixed at the primitive level — `Card`, `TableWrap` and `Field` can all shrink now — rather
than per page, so new pages inherit the fix. The sweep in `scripts/visual-check.mjs`
asserts on it directly (`scrollWidth > innerWidth`) at both widths, alongside console
errors and failed requests, so it cannot regress silently.

## D24 — An escalation nobody answers needs a bounded outcome

Found by leaving an intervention open during testing: the invoke request hung forever and
a live browser session stayed pinned. The escalation promise had no timeout, so "waiting
for a human" was indistinguishable from "wedged".

An unanswered escalation is a real operational state — the operator went home, the alert
was missed — so it now resolves to `abandon` after a bounded wait
(`DEX_ESCALATION_TIMEOUT_MS`, default 15 minutes), returns the lease so the parked run
unblocks, and records that it was closed by the system rather than by a person. The timer
is `unref`d so it cannot keep the process alive on its own, and it is cleared the moment
a human resolves the intervention.

`tests/handoff.test.ts` covers the whole control-transfer model, including that automation
genuinely parks and resumes, that approving a step is distinguishable from performing it,
and both halves of the timeout (it fires when ignored; it is cancelled when answered).

## D25 — Cross-tenant reuse, demonstrated rather than argued

Stretch goal: one artifact recorded on a base install, applied to a second variant with
per-variant overrides. Previously the *mechanisms* existed (ranked strategies as aliases,
two tenants) but nothing proved they composed. Now they do.

`tenantOverrides` on the capability carries only what a base recording genuinely cannot
know — where this institution's install lives, and any label it has renamed since.
`specializeForTenant()` returns a new capability rather than mutating, so one loaded
artifact serves every tenant in the same process. Aliases are *appended* to the ranked
strategies, never substituted, so the base labels stay the higher-confidence first choice
and the tenant's wording is a recorded fallback.

Deliberately narrow: an override can change the entry point and add aliases. It cannot
change steps, outcomes or policy. A tenant needing different *behaviour* is a fork worth
reviewing, not a config value, and gets its own artifact with `tenant: "<id>"`.

**The demonstration.** `cu.member.read_savings_balance`, recorded against First Community,
replayed against Summit — a different host, "Member Number" instead of "Member ID",
"Find" instead of "Search", "Regular Savings" instead of "Savings Balance", swapped row
order, and an extra acceptable-use screen after sign-in. Result: `success`, same outputs.
`999999` still returns `MEMBER_NOT_FOUND`.

The run log is the interesting part, because it shows *how*:

```
entryPoint: .../t/summit   tenant: summit
outcome_detected: ACKNOWLEDGEMENT_REQUIRED -> recover
recovery:         ACKNOWLEDGEMENT_REQUIRED
resolution:       "the Member ID field" -> strategy #1 (label_proximity, conf 0.7)
```

That last line is the drift signal from REPORT §4 working in practice. Nothing failed, but
the log records that this tenant needed a fallback strategy to resolve a control. A tenant
whose runs start leaning on fallbacks is drifting, and it is visible well before anything
breaks.

## D26 — Making the nav real broke the agent, and that was worth knowing

Turning the menu bar into working links immediately broke discovery. The agent's first
move was to click "Members", which navigated away from the sign-in screen, after which it
correctly reported that no login form was present and stopped.

Two separate causes, both worth fixing rather than papering over.

**A latent bug the chrome exposed.** `observeSettled` waited for "any actionable node"
before showing the model a screen. That was adequate while the only actionable things
were inside the content frame. With a real navigation bar the top-frame links are
*always* actionable, so the check passed instantly and the model was handed a page whose
working area had not loaded. It then reasoned correctly from a screen that was simply
wrong. Now, when child frames exist, the settle waits for actionable nodes *inside* one —
chrome is not content.

**A prompt gap.** The agent was never told the difference between application chrome and
the working area. Real operators make that distinction without thinking; a model has to
be told which controls advance the task and that the menu will take it somewhere else.

Worth noting the failure mode: the agent did not crash or click wildly. It reported
`blocked` with an accurate description of what it saw. The guardrail worked even while the
perception feeding it was wrong, which is the behaviour I would want.

## D27 — The evidence generator deleted the evidence it was meant to protect

`generate-evidence.ts` preserved directories matching `discovery-*` and deleted the rest,
then renamed the survivor to `01-discovery-llm-run`. On the *next* run that name no longer
matched the pattern, so the script deleted the one artifact in the whole repository that
costs a model call to reproduce.

Now both forms are protected, the canonical name is preferred when present, and the script
warns rather than silently continuing if no discovery run exists at all. The general
lesson is the same one as D13: a destructive operation whose guard is a string pattern
needs a test or an assertion, because the failure is silent and looks like success.

## D28 — The review loop is operable, which is what makes the draft gate real

Until now the draft → approved gate was a claim the system made and a human could only
honour by editing JSON over SSH. A gate nobody can pass is not a workflow, so the console
now runs discovery, edits capabilities, and approves them.

Three operations, each deliberately shaped:

**Run discovery** (`POST /api/discovery`). Asynchronous with a polled job, because a run
takes tens of seconds and holding an HTTP request open for it buys nothing. It has its own
allowlist, separate from any capability's policy: "signed in to the console" and "may aim
an LLM-driven browser at an arbitrary URL" are different privileges and are gated
separately. Verified — an off-list entry point is refused.

**Edit** (`PUT /api/capabilities/:ref`). Validated against the same Zod schema the replay
engine parses with, so the console cannot write an artifact the executor would reject at
runtime; the failure happens at save time with a human present to read it. Verified — a
`riskClass: "catastrophic"` edit comes back with the exact path and expected values.
Saving under a new version writes a new file, so editing an approved capability is
naturally a new reviewable artifact rather than a silent mutation of something in
production.

**Approve** (`POST /api/capabilities/:ref/status`). One click, reversible; pulling a
capability back to draft stops it running unattended immediately.

**The loop, end to end, demonstrated.** The agent's draft returned `CHECKPOINT_FAILED` on
member 999999 — technically true, useless to a caller. A human adds one outcome rule
through the API; the same replay now returns `MEMBER_NOT_FOUND`. Still refused unattended
while draft. Approved, and unattended invocation succeeds and the capability appears in
the callable tool catalog.

Both states are kept: `cu.member.lookup_savings@1.0.0` is exactly what the model emitted
(draft, zero outcomes), `@1.1.0` is the reviewed version (approved, one outcome). The
compare view diffs them, which makes "what review contributes" concrete rather than
asserted.

## D29 — Jump-to-next-anomaly, and comparing capabilities

Two small things that change how the evidence is actually used.

The run timeline marks anomalies and steps through them with `n`: a policy refusal, a
detected outcome, a recovery, an escalation, a failed checkpoint, a locator that needed a
fallback strategy, or a run that did not end in success. Scanning three hundred events for
the one denial was the real task on that page.

The compare view diffs two capabilities as pretty-printed JSON with a plain LCS, ignoring
provenance (which differs on every run and says nothing about the flow). A few hundred
lines makes O(n·m) imperceptible and avoids a dependency.

## D30 — `min-width: auto` cost me four attempts, so here is the rule

The capabilities page overflowed by 9px on a phone and resisted three fixes. The chain:
the card is a grid *item*; grid and flex items default to `min-width: auto`; the card's
min-content was set by a title using `truncate`, which implies `white-space: nowrap`, so
the "truncating" element reported its full string as a minimum and widened everything
above it.

Two rules worth stating plainly, because I rediscovered both the hard way:

  - `truncate` does nothing useful on a flex/grid child without `min-w-0`. It will not
    ellipsis; it will widen the parent.
  - Any flex or grid item that contains text you expect to shrink needs `min-w-0`,
    including the item itself, not only its container.

I also wasted one attempt patching the first `className="no-underline"` in the file, which
was a button rather than the card. Measuring beat guessing: walking the DOM for elements
whose right edge exceeded the viewport found it in one pass, after three edits based on
plausible theories had not.

## D31 — What a line-by-line review turned up

Four defects, found by reading rather than by a failing test.

**Discovery was not gating risk at all.** `loop.ts` passed a hardcoded
`riskClass: "safe"` into the policy engine, so an irreversible action proposed by the
model would have been permitted — while D10 and REPORT §6 both claimed discovery pauses
for a human on exactly that. The code was wrong, not the documentation. Risk is now
classified from the control's label with `classifyActionRisk`, shared with the recorder so
the two cannot disagree about what "irreversible" means.

The two callers feed it different text on purpose. The gate sees only the control's label,
because a benign click explained by the model as "submit the search" must not be refused
for containing the word. The recorder also sees the step intent, since its output is a
suggestion a reviewer reads rather than a decision that halts a run.

**The step loop had no absolute ceiling.** Per-rule `maxAttempts` bounds each recoverable
condition, but an `escalate` disposition a human keeps resuming could cycle forever.
`HARD_STEP_ATTEMPT_CAP` stops any single step after eight attempts with
`RECOVERY_EXHAUSTED`. A run that cannot pass one step in eight tries is not going to.

**`new URL("")` crashed the recorder.** A frame created but not yet navigated reports an
empty url; it is absent from the "before" set, so it looked like a navigation and then
failed to parse — killing a discovery run at the recording stage, after all the model
calls had been paid for. Only http(s) urls count as destinations now.

**Ref numbers had gaps.** `observe()` incremented the counter before the guards that skip
unaddressable nodes, so the model saw `ref_1, ref_4, ref_9`. Harmless but confusing;
numbering now happens once a node is known to be kept.

Also checked and found sound: Express route ordering (`/tools` really is registered before
`/:ref`), no TODOs, no empty catches, no stray `console.log` in library code, and the
three remaining `as any` casts are all at genuine type boundaries (CDP parameters Playwright
does not type). The synthetic action the discovery loop hands the policy engine is now a
real typed object rather than a cast, so a future policy that reads the target will fail to
compile instead of silently checking nothing.

`tests/recorder.test.ts` covers the risk heuristic, the targeting rank order, and both
halves of the URL guard.

## D32 — The session clock became a checkpoint

Found by looking at the diff view rather than by a test: a freshly discovered capability
contained `text_present("00:00:03")`. The teller shell had grown a ticking session clock,
that text was genuinely new after the action, and the recorder duly asserted on it — a
checkpoint true for exactly one second and false on every subsequent run.

The existing guard required a marker to contain `[a-z0-9]`, which a clock satisfies. It
now requires an actual **letter**, plus an explicit reject for clock, date and timestamp
shapes anywhere in the line. Three bad markers disappear at once: password bullets
(verifies nothing), the clock (true once), and bare currency like `$8,214.55` (true for
one member and wrong for every other).

The wider point: a derived checkpoint is a guess about what *characterises* a screen, and
the failure mode is not an error — it is a capability that silently stops working later.
Adding realistic chrome to the application introduced volatile text, and the recorder had
no notion that some text is unsuitable to assert on. It does now, and
`tests/recorder.test.ts` covers clocks, dates, timestamps and currency.

Worth noting how it surfaced: not from a failing test, but from reading a rendered diff of
two artifacts. The diff view paid for itself within an hour of existing.

## D33 — "Not secure" was never the certificate

Reported as a cert problem. It was not. The chain is correct — leaf, Let's Encrypt YR1,
ISRG Root YR — the SAN covers all five names, and an independent client using only the
system trust store validates every host.

Two real causes, neither of them TLS:

**No HSTS.** Typing a bare hostname makes the browser try http first. The 301 to https is
immediate, but Chrome marks that hop "Not secure" before it lands. Added
`Strict-Transport-Security` to every TLS server block, at `max-age=86400` and *without*
`includeSubDomains` — HSTS is sticky, and a demo has no business pinning a year-long
policy across every subdomain.

**A cached error.** The certificate's `notBefore` is the moment it was expanded to cover
`teller`, `console` and `api`. Any visit before that got a genuine name mismatch, and
browsers cache that hard. Nothing server-side could have fixed it; a hard reload does.

The lesson is about diagnosis rather than TLS: the fix was not on the reported component.
Checking the chain from an independent client first, instead of adjusting nginx, is what
kept this from turning into an afternoon of changing certificate config that was already
right.

## D34 — Two gaps the brief caught that I had not

Re-reading §3 line by line against the running system, rather than against my memory of it.

**A one-key shortcut was shadowing a sequence.** `useHotkeys` resolved direct matches
before pending sequences, so `r` (toggle auto-refresh) made `g r` (go to runs)
unreachable — a key bound on its own can silently eat every sequence ending in the same
letter. Sequences now resolve first, and a key that prefixes one is never also an action.
Found by driving the console rather than reading it.

**The timeout stopping condition did not exist.** §3.1 lists "max steps, timeout,
dead-end". `DiscoveryError` declared `"timeout"` as a reason and nothing ever threw it.
Max steps is not a time bound: measured provider latency on this free tier ranged from
0.8s to 120s per call, so a 22-step run is somewhere between thirty seconds and forty
minutes. I hit exactly that earlier when NIM degraded mid-run. There is now a wall-clock
budget (`DEX_DISCOVERY_TIMEOUT_MS`, default five minutes), verified in both directions:
a 1ms budget stops the run, a normal one still completes.

`scripts/interaction-check.mjs` now drives the console end to end — nineteen behaviours
including hotkeys, the command palette, filters, the approval toggle, schema rejection on
a bad edit, anomaly jump and the diff. The visual sweep proves pages render; this proves
their controls do something.

## D35 — A shared footer with relative links pointed at the wrong site

The footer is rendered by both the public site and the console, which are different
origins. Its "Reference" column used relative hrefs — `/`, `/#how`, `/#safety`. Correct on
the site; on the console they resolved to console routes, so "How it works" landed on the
operator overview instead of the explainer, and "Overview" collided with the console's own
nav item of the same name.

Cross-surface links are now absolute and centralised in a `SURFACES` constant, the column
is titled "Learn", and the footer takes a `current` prop so the surface you are already on
renders as plain text with `aria-current="page"` rather than a link back to itself.

The general shape of this bug: a component shared across origins cannot use relative URLs
for anything that is not genuinely local, and it fails silently — every link still
resolves, just to the wrong place.

## D36 — Dead and mis-named npm scripts

`npm run operator` invoked a CLI command that no longer exists; it predates consolidating
the API and the console into one process, and had been quietly printing usage and exiting
1 for some time.

Worse, the README told a reader to run `npm run serve` while the script was named
`server` — a documented command that simply failed. The script is now `serve`, matching
both the README and the CLI's own `serve` command. Renaming it exposed a third problem:
`dev` still composed `npm:server`, so `npm run dev` would have broken.

There is now a check that every `npm:` reference inside `dev` resolves to a real script,
and the whole documented command list is verified to exist. A README command nobody has
run is a broken command, and the only way to know is to run it.

## D37 — Documentation is checked, not proofread

`scripts/doc-check.mjs` verifies the docs against the repository they describe: every
repo-relative link and inline path resolves, every `npm run …` a reader might type exists,
the cited test count matches a real run, every capability named in the README has an
artifact, every evidence directory described is present, and every embedded screenshot
exists.

It found two drifts immediately — the README claimed 68 unit tests when there were 72, and
it had been pointing at `npm run serve` while the script was still named `server`. Neither
is visible by reading; both are obvious to a script.

`DECISIONS.md` is exempted from the command check. It is a changelog and legitimately
names things that were removed — "`npm run operator` invoked a command that no longer
exists" is accurate prose, not a broken instruction. That exemption is the kind of thing
worth writing down, because the alternative is quietly weakening the check for everyone.

The index at the top of this file is generated by `scripts/decisions-index.mjs` from its
own headings. A hand-kept index that drifts is worse than none, because it sends a reader
to the wrong place.

## D38 — REPORT.md was twice the length the brief asked for

The brief asks for roughly one to three pages. The write-up had reached 3,445 words, call
it six or seven. Reviewers read these side by side, and overlong is its own signal.

Trimmed to 2,343 words with all seven required headings intact and no argument dropped.
What went was narrative: the long-form account of each bug now lives only in this file,
which is explicitly the long-form log, and REPORT cites the decision instead of retelling
it. Measurements stayed, because they are what make the claims checkable rather than
assertions.

The split is now clean: REPORT is the argument, DECISIONS is the evidence and the history.
