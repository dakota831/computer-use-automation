# Decision log

Running notes, newest last. Each entry: what was decided, the alternative, and why.
This is the raw material for REPORT.md — it exists so the reasoning is captured at
the moment of the decision rather than reconstructed afterwards.

---

## Index

Newest entries are at the bottom of the file; this index groups them by subject.

**Foundations**  
[D1](#d1--typescript-single-package) typescript, single package · [D2](#d2--perception-is-the-accessibility-tree-over-cdp-not-the-dom) perception is the accessibility tree over cdp, not the dom · [D3](#d3--nvidia-nim-as-the-model-provider) nvidia nim as the model provider

**The artifact and how controls are found**  
[D4](#d4--locator-strategies-are-ranked-and-ambiguity-is-a-failure) locator strategies are ranked, and ambiguity is a failure · [D5](#d5--one-assertion-vocabulary-for-checkpoints-success-and-error-detection) one assertion vocabulary for checkpoints, success, and error detection · [D11](#d11--the-surface-seam-and-a-bug-that-proves-why-geometry-is-not-a-locator) the surface seam, and a bug that proves why geometry is not a locator · [D21](#d21--visual-realism-and-machine-hostility-are-independent-axes) visual realism and machine hostility are independent axes

**Replay, errors and determinism**  
[D9](#d9--a-business-outcome-is-not-throwable) a business outcome is not throwable · [D12](#d12--after-an-action-wait-for-a-_recognised_-state-not-just-the-expected-one) after an action, wait for a _recognised_ state, not just the expected one · [D32](#d32--the-session-clock-became-a-checkpoint) the session clock became a checkpoint

**Safety and risk**  
[D6](#d6--risk-is-classified-at-record-time-not-replay-time) risk is classified at record time, not replay time · [D8](#d8--redaction-happens-on-the-write-path-not-at-call-sites) redaction happens on the write path, not at call sites · [D10](#d10--policy-is-checked-before-every-action-and-enforced-twice) policy is checked before every action, and enforced twice · [D14](#d14--the-model-never-sees-a-credential) the model never sees a credential · [D31](#d31--what-a-line-by-line-review-turned-up) what a line-by-line review turned up

**Discovery and the review loop**  
[D15](#d15--a-discovered-capability-is-always-a-draft) a discovered capability is always a draft · [D16](#d16--two-recorder-bugs-the-first-real-run-exposed) two recorder bugs the first real run exposed · [D17](#d17--provider-quirks-belong-at-the-adapter-boundary) provider quirks belong at the adapter boundary · [D26](#d26--making-the-nav-real-broke-the-agent-and-that-was-worth-knowing) making the nav real broke the agent, and that was worth knowing · [D28](#d28--the-review-loop-is-operable-which-is-what-makes-the-draft-gate-real) the review loop is operable, which is what makes the draft gate real · [D34](#d34--two-gaps-the-brief-caught-that-i-had-not) two gaps the brief caught that i had not

**Escalation and control transfer**  
[D18](#d18--the-control-lease-and-why-automation-parks-rather-than-stops) the control lease, and why automation parks rather than stops · [D19](#d19--approving-a-risky-step-is-not-the-same-as-doing-it) approving a risky step is not the same as doing it · [D24](#d24--an-escalation-nobody-answers-needs-a-bounded-outcome) an escalation nobody answers needs a bounded outcome

**Multi-tenant**  
[D25](#d25--cross-tenant-reuse-demonstrated-rather-than-argued) cross-tenant reuse, demonstrated rather than argued

**Interface and operations**  
[D20](#d20--reversing-d-nothing-the-console-needed-a-real-router) reversing d-nothing: the console needed a real router · [D22](#d22--one-theme) one theme · [D23](#d23--the-mobile-overflow-was-a-flexgrid-default-not-a-styling-mistake) the mobile overflow was a flex/grid default, not a styling mistake · [D29](#d29--jump-to-next-anomaly-and-comparing-capabilities) jump-to-next-anomaly, and comparing capabilities · [D30](#d30--min-width-auto-cost-me-four-attempts-so-here-is-the-rule) `min-width: auto` cost me four attempts, so here is the rule · [D33](#d33--not-secure-was-never-the-certificate) "not secure" was never the certificate · [D35](#d35--a-shared-footer-with-relative-links-pointed-at-the-wrong-site) a shared footer with relative links pointed at the wrong site · [D36](#d36--dead-and-mis-named-npm-scripts) dead and mis-named npm scripts

**Measurements and mistakes worth keeping**  
[D7](#d7--measured-against-the-real-target-app-not-assumed) measured against the real target app, not assumed · [D13](#d13--two-silent-patch-failures-and-what-they-cost) two silent patch failures, and what they cost · [D27](#d27--the-evidence-generator-deleted-the-evidence-it-was-meant-to-protect) the evidence generator deleted the evidence it was meant to protect

**Also**  
[D37](#d37--documentation-is-checked-not-proofread) documentation is checked, not proofread · [D38](#d38--reportmd-was-twice-the-length-the-brief-asked-for) report.md was twice the length the brief asked for · [D39](#d39--making-template-references-hard-to-get-wrong) making template references hard to get wrong · [D40](#d40--authoring-rewritten-for-the-person-who-actually-does-it) authoring, rewritten for the person who actually does it · [D41](#d41--a-timeout-that-was-only-ever-a-report) a timeout that was only ever a report · [D42](#d42--the-build-and-the-deploy-were-two-steps-and-they-drifted) the build and the deploy were two steps, and they drifted · [D43](#d43--giving-the-application-something-worth-guarding) giving the application something worth guarding · [D44](#d44--the-gate-was-guarding-the-doorway-not-the-transaction) the gate was guarding the doorway, not the transaction · [D45](#d45--discovery-can-now-ask-because-somebody-is-there-to-answer) discovery can now ask, because somebody is there to answer · [D46](#d46--a-literal-that-is-really-a-mangled-parameter) a literal that is really a mangled parameter · [D47](#d47--two-callers-two-answers-one-of-them-by-luck) two callers, two answers, one of them by luck · [D48](#d48--two-bugs-the-new-write-action-exposed-in-the-recorder) two bugs the new write action exposed in the recorder · [D49](#d49--what-the-mobile-sweep-is-entitled-to-assert) what the mobile sweep is entitled to assert

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
needs a _text_ model, not a vision model. That is what makes a free tier viable at all,
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
risk surface of a capability is fixed and reviewable _before_ it is ever allowed to run
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
   is not a CDP frame id. Passing it silently returns the _top_ frame's tree again
   rather than erroring — a quiet wrong answer, which is the failure mode this whole
   project is about. With real ids, the inner frame yields 34 nodes.

3. **The login fields have no accessible name at all.** The inner frame exposes two
   nodes of role `textbox` with empty names, while "User ID:" and "Password:" exist
   as separate `LayoutTableCell` nodes beside them. Role+name targeting _cannot_
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
it is a _response_ to a hard failure or a risky step, which keeps "what happened"
separate from "what we decided to do about it".

## D10 — Policy is checked before every action, and enforced twice

A plan approved up front says nothing about what the next action will be: during
discovery the model picks each action freshly, and during replay a page can redirect
between steps. So `PolicyEngine.check()` runs per action, and non-navigation actions are
validated against the _current_ URL — a session that has drifted off-allowlist cannot
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

## D12 — After an action, wait for a _recognised_ state, not just the expected one

The first replay loop checked the outcome detectors once, immediately after acting, and
then polled only the checkpoint. That is wrong, and the target app exposed it:

A click that submits a form starts a navigation, so observing straight afterwards
samples the _old_ page. For member 200001 the permission-denied screen was therefore
never detected. Worse, that screen reuses the "Member Detail" panel title, so the
checkpoint later matched, every step "passed", and the run died at the very end with
"could not extract declared outputs" — a legitimate business outcome reported as an
extraction bug, three steps away from the actual cause.

Outcomes and checkpoints are now polled _together_ in one `settle()` loop: after every
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

The agent is told which secret _keys_ exist and emits `{{secret:corelink.password}}`;
the loop substitutes the value at the moment of typing. So the password is absent from
the prompt, from the transcript, and from the artifact — not redacted after the fact,
never present. The same template is what replay resolves later, so one mechanism serves
discovery and production.

## D15 — A discovered capability is always a draft

The recorder emits `status: "draft"`, never `approved`, and this is a correctness claim
rather than caution. One successful run proves the happy path. It cannot know what the
_error_ states look like, because it never saw one.

The evidence is direct. The agent's own artifact replays cleanly for member 100001 and
100003, and on 999999 it returns `CHECKPOINT_FAILED` — technically true, but useless to a
caller. The hand-authored baseline returns `MEMBER_NOT_FOUND`, because a human wrote the
outcome table. That gap _is_ the review work, and it is exactly what the draft → approved
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
It is now derived against the _first_ observation of the run ("what is true at the end
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
the run does not terminate — it _parks_, awaiting the lease. Terminating would lose the
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
directly: operator input sent _before_ taking control is refused by the server with
`control is held by "automation"`. A client that ignores the UI still cannot act.

Operator input goes through the same CDP Input domain the automation uses, so the
handoff cannot drift from the behaviour of the thing it is taking over from — one code
path, exercised by both.

## D19 — Approving a risky step is not the same as doing it

Two distinct resolutions, because they mean different things to the audit trail:

`resume` the human authorised it; automation performs the step
`step_completed` the human performed it themselves; automation skips it

The first is what the irreversible-step gate is for. Replay reaches `s9_confirm`, refuses
to create an account on its own authority even though the capability is approved and
every prior step ran unattended, and asks. On approval it performs the click itself. The
human decided; the machine acted. That distinction is exactly what an auditor needs, and
collapsing the two would lose it.

Recorded human actions log key _names_, never typed characters — an operator entering a
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

None of the properties that make it a _useful_ target changed: content still lives inside
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
per-variant overrides. Previously the _mechanisms_ existed (ranked strategies as aliases,
two tenants) but nothing proved they composed. Now they do.

`tenantOverrides` on the capability carries only what a base recording genuinely cannot
know — where this institution's install lives, and any label it has renamed since.
`specializeForTenant()` returns a new capability rather than mutating, so one loaded
artifact serves every tenant in the same process. Aliases are _appended_ to the ranked
strategies, never substituted, so the base labels stay the higher-confidence first choice
and the tenant's wording is a recorded fallback.

Deliberately narrow: an override can change the entry point and add aliases. It cannot
change steps, outcomes or policy. A tenant needing different _behaviour_ is a fork worth
reviewing, not a config value, and gets its own artifact with `tenant: "<id>"`.

**The demonstration.** `cu.member.read_savings_balance`, recorded against First Community,
replayed against Summit — a different host, "Member Number" instead of "Member ID",
"Find" instead of "Search", "Regular Savings" instead of "Savings Balance", swapped row
order, and an extra acceptable-use screen after sign-in. Result: `success`, same outputs.
`999999` still returns `MEMBER_NOT_FOUND`.

The run log is the interesting part, because it shows _how_:

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
_always_ actionable, so the check passed instantly and the model was handed a page whose
working area had not loaded. It then reasoned correctly from a screen that was simply
wrong. Now, when child frames exist, the settle waits for actionable nodes _inside_ one —
chrome is not content.

**A prompt gap.** The agent was never told the difference between application chrome and
the working area. Real operators make that distinction without thinking; a model has to
be told which controls advance the task and that the menu will take it somewhere else.

Worth noting the failure mode: the agent did not crash or click wildly. It reported
`blocked` with an accurate description of what it saw. The guardrail worked even while the
perception feeding it was wrong, which is the behaviour I would want.

## D27 — The evidence generator deleted the evidence it was meant to protect

`generate-evidence.ts` preserved directories matching `discovery-*` and deleted the rest,
then renamed the survivor to `01-discovery-llm-run`. On the _next_ run that name no longer
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
the card is a grid _item_; grid and flex items default to `min-width: auto`; the card's
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

The wider point: a derived checkpoint is a guess about what _characterises_ a screen, and
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
`Strict-Transport-Security` to every TLS server block, at `max-age=86400` and _without_
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

## D39 — Making template references hard to get wrong

A goal that writes `100001` where it meant `{{memberId}}` still runs, still succeeds, and
produces a capability that only ever works for one member. Nothing errors. The cost of a
typo here is a wasted model call and a silently useless artifact, so the references are now
impossible to mistype:

- **Every available reference is listed**, built from the parameter name the operator is
  typing plus the secret keys the server reports. Secrets are styled as the more dangerous
  thing.
- **Click to insert at the caret**, **drag onto the goal**, or **type `{{` and
  autocomplete**.
- The server exposes secret **key names only** on `/api/discovery`. The values never leave
  it, and the model only ever sees the reference either.

**The sign-in clause is fixed.** Every flow against this application starts by signing in,
so it is shown as a locked prefix rather than retyped — and cannot be forgotten, which was
a real way to waste a run.

Two bugs the browser test caught that the unit tests would not have:

**Substring matching was wrong.** `{{m` offered `secret:corelink.username`, because
"username" contains an "m". Technically a match, useless as a suggestion. Now prefix
matching on the label and on each `:`/`.`-separated segment, so `{{m` gives `memberId`
alone while `{{user` still reaches `secret:corelink.username`.

**Escape did nothing.** `keyDown` closed the list and `keyUp` immediately re-ran detection
and reopened it on the same keystroke. The dismissed token is now remembered until the
token actually changes.

Both are the kind of defect that only appears when a real keyboard drives a real browser,
which is why `scripts/interaction-check.mjs` exists alongside the unit tests.

## D40 — Authoring, rewritten for the person who actually does it

The teach and edit screens were built for someone who already knew the schema. The people
who will use them do not, and should not have to.

**Teaching.** The institution is a picker, not a URL box — which is also a tighter control
than the origin allowlist, since the entry point can only be one of a closed list. The
step budget is gone; it was a safety bound the operator had no basis to set, so the server
keeps it. Values appear as rows the moment the task references `{{something}}`, and vanish
when it stops. The identifier is derived from the title, with an override behind
_Advanced_. Credentials are not shown at all: signing in is a fixed part of every task and
the executor supplies them, so there is no reason for an operator to see a
`{{secret:…}}` reference and every reason not to.

**Editing.** The reviewer's job is narrow — confirm the steps say what they expect, and
write down what should happen when the application does something other than succeed — so
that is what the screen exposes. Sign-in steps are collapsed to one line, because nobody
reviews them. Outcomes are asked for as "what happened", "how would you know", "what
should happen then", with dispositions worded as _Report it as the answer_ / _Deal with it
and carry on_ / _Ask a person_ / _Stop with an error_. The raw document stays reachable
behind a disclosure for the rare case that needs it.

**The bug this exposed, which matters more than the UI.** The first version of the editor
could not round-trip a detector: the console's document type omitted it, so saving replaced
a tested match with a guess derived from the description. Worse, the schema then rejected
the document and the save silently failed — my browser check asserted on a toast and
passed while the file on disk never changed. Only `git status` caught it.

Two lessons. A type that is narrower than the document it represents will lose whatever it
omits, silently. And a UI test that asserts on a success message rather than on the
resulting state will confirm a save that did not happen.

Now verified end to end: an operator adds "this teller may not view the record" through the
form, and `200001` returns `THIS_TELLER_MAY_NOT_VIEW_THE_RECORD` as a business outcome
instead of `CHECKPOINT_FAILED` — while `MEMBER_NOT_FOUND`'s original detector survives the
save byte for byte.

## D41 — A timeout that was only ever a report

An operator taught a capability, watched the console say `PENDING` for five minutes, and
gave up. Three separate faults met in that one screen, and only one of them was the model's.

**The run could not do what was asked.** The goal was "deduct $0.99 listed as Maintenance
Fee from all their accounts". The teller application has no fee-posting screen — its only
write action is _Open Sub-Account_ — so the control the agent needed did not exist. It hunted
for twenty-one steps, signed out, searched again, and ran out of clock. That part is
arguably correct behaviour: it declined to invent a step. But it never said so.

The goal was also unrecordable in a second way. "All their accounts" is a loop over a count
known only at run time, and a capability is a fixed list of steps. Even with a fee screen,
one pass could only ever have recorded one account.

**The budget was not a bound.** `timeoutMs` was checked between steps, and nothing bounded
a request in flight. One completion took 108 seconds; the run finished 11 seconds past a
300-second budget having spent most of it inside two calls. The real ceiling was worse than
that: `fetch` with no signal inherits undici's 300s header timeout, and with four retries
the worst case for a _single step_ was longer than the entire run was permitted. A wall-clock
budget enforced only at step boundaries is a report on how long the run took, not a limit
on it. The client now takes the deadline as an `AbortSignal` and a per-request ceiling, will
not start an attempt it has no time to act on, and will not back off past the budget.

Writing the test for that found a second bug in the fix. The guard threw a plain `Error`
from inside the retry loop's `try`, where the loop's own `catch` caught it and retried —
so the escape hatch landed one rung further down the ladder it was trying to leave. Budget
and cancellation failures are now a distinct `NonRetryable` type the catch arm rethrows.
A guard inside a retry loop has to be a different _kind_ of failure, not just a different
message.

**Nothing was visible while it happened.** The job carried its status and nothing else, the
badge rendered `running` as `PENDING`, the evidence link appeared only on success, and there
was no way to stop it. The panel now shows the step, the elapsed time against the budget,
and the agent's own sentence about what it is doing — which is a better description than any
summary generated from the tool name, because the model already wrote it for a human. The
evidence link exists from the first step, since the evidence for a failed run is the evidence
worth reading. A Stop button aborts the in-flight request and reports "Stopped by the
operator" rather than whichever internal call first noticed the abort.

**And the form now says so up front.** A goal containing "all", "each" or "every" is flagged
before the run starts, explaining that a capability is learned once for one record. Five
minutes of silence followed by `timeout` teaches an operator nothing; a sentence in the form
costs nothing and is the only feedback available before the clock starts.

Three prose-only replies in a row now end the run as a dead end rather than burning the
budget: five of the twenty-one steps in that run were the model narrating instead of
deciding, and the prompt it gets back now names `blocked` as the thing to call when the
screen has no control that would help.

The check that opens a run timeline and asserts it has anomalies was asserting on the test
data rather than the console — a clean run legitimately has none, so it failed the moment a
clean run was the most recent. It now scans for a run that has them.

## D42 — The build and the deploy were two steps, and they drifted

Verifying the fix above turned up something worse than the bug. `npm run web:build`
writes to `dist-web/`; nginx serves `/var/www/dex/app`. Nothing connected them but my
memory of copying one to the other. The live site had been serving a bundle from an
earlier build for some time, so a fix could be committed, tested green against
`127.0.0.1:4000`, and still be absent from the URL the operator actually opens.

This is the same failure as the silent save in [D40](#d40--authoring-rewritten-for-the-person-who-actually-does-it),
one layer out: a check that passes against the artifact rather than against the thing
being served will confirm work that never shipped. Local tests were honest about the
repository and said nothing about the deployment.

`npm run deploy:web` now builds and `rsync --delete`s in one command, and the interaction
sweep is run against `https://console.dexdash.cloud` — the real host, over TLS, through
basic auth — rather than only the loopback port. Testing the loopback tests the build;
testing the URL tests the deploy.

## D43 — Giving the application something worth guarding

The teller app had one write action, _Open Sub-Account_, and it opened an account with
no money in it. Everything else was a read. That made the risk machinery hard to take
seriously: a policy engine that classifies actions as irreversible, an approval gate
that blocks unattended replay of drafts, and a human-handoff protocol, all guarding a
lookup. It also meant an operator who wanted to teach a fee deduction simply could not,
which is how this started.

So the app now has a posting screen: account, entry type, amount, description, confirm,
and a receipt with a reference and the resulting balance. It moves money, it is not
reversible from any screen, and it refuses in four distinct ways — no such account, the
account is not open, the amount is not positive, and the member's records are
restricted. The restricted case needed a new fixture account: without one the lookup
failed first and the screen answered "no such account", so the permission path had never
been reachable. An exceptional state that cannot be reached is not covered, it is only
claimed.

**Seed and ledger are kept apart.** Postings go to an in-memory ledger and every balance
the application renders is the seed folded with what has been posted against it. That is
what lets the write be genuinely irreversible for a teller while the committed evidence
stays reproducible: `resetLedger()` returns everything to seed, and both the replay
matrix and the evidence generator call it before they measure anything. The member record
and the account register fold the same ledger, because two screens that disagree about a
balance would be a bug no real core system has.

## D44 — The gate was guarding the doorway, not the transaction

Teaching the fee capability worked, and then the run log showed what the policy engine
had actually done:

```
step 6  click -> irreversible  confirm     <- the "Post Adjustment" link
step 9  click -> risky         allow       <- the "Confirm" button that posts the fee
```

`classifyActionRisk` judged a control by its own label and nothing else. "Post Adjustment"
matched _post_ and was gated as irreversible — but that link only opens a form, and
nothing has happened yet. The button that actually moves the money says "Confirm", which
matched only the committing list, and was waved through. The gate stopped the agent at
the doorway and ignored the transaction.

This is not a tuning problem. A label alone cannot distinguish "Confirm" on a preferences
page from "Confirm" on a posting screen; the information needed is on the screen, not on
the control. So a committing control now inherits the consequence of the screen it
commits, and the classifier takes the surrounding title and text. Navigation is
deliberately _not_ promoted this way — moving around a dangerous screen is not itself
dangerous, and promoting every click on it would make the gate fire so often that an
operator would learn to click through it.

It was already the case that both the recorder and the discovery loop shared this
function, which is the only reason one fix covered the gate and the recorded artifact.

## D45 — Discovery can now ask, because somebody is there to answer

With the gate corrected, discovery could not learn the capability at all: the step it
needed was irreversible, and discovery refused every irreversible step on the grounds
that it runs unattended. That is true of `npm run discover`. It is false of discovery
started from the console, where an operator is watching a progress panel — and refusing
there does not make the system safer, it makes it unable to learn exactly the operations
that most deserve a reviewed capability wrapped around them.

So a confirmation during discovery is now an ordinary intervention. Same registry, same
console screen, same live-session handoff that replay has always used: the run parks on
an un-awaited promise, the operator sees what the agent wants to do and why policy
stopped, and approving resumes the run on the same session with the step recorded like
any other. Only `resume` means go ahead — if the operator performed the step themselves,
repeating it would post the entry twice. With no hook supplied the old refusal stands, so
the CLI is unchanged.

Making the registry serve both callers meant `raise()` taking the eight fields it actually
reads rather than an `EscalationContext`. Replay has a parsed Capability and a Step to
hand; discovery has neither, because it is in the middle of producing the first one. The
test fixture that used to fake a context with three `as any` casts now needs none.

The progress panel distinguishes parked from thinking. A spinner on a run that is waiting
for you is a lie, and the run would sit there until the escalation timed out.

## D46 — A literal that is really a mangled parameter

The first artifact recorded through the new flow contained this step:

```
s12_type   type   '100001-S0'   risk=safe
```

The account number supplied for that run was `0001-100001-S0`. The model typed a
fragment of it while casting around, and `templatize` — which matches a typed value
_exactly_ — found no match and recorded the fragment as a constant. As recorded, that
capability types one particular run's data on every future run.

This is the worst shape a bug can take here: it replays cleanly and does the wrong thing,
so nothing downstream detects it. Checkpoints were already guarded against per-run values
after an earlier incident; action values were not, which is the same lesson arriving at a
second call site.

A literal sharing five or more characters with a supplied value is now flagged on the
step. Deliberate constants do not overlap an account number, so "Maintenance Fee" does
not fire. The step is still recorded and still replayable — this is a reason not to
approve the draft, not a reason to throw away an eighteen-step run — and the console
shows it during review, which is where a draft was always going to have to pass.

## D47 — Two callers, two answers, one of them by luck

With the classifier reading screen context, the run log still showed the gate allowing the
Confirm click — while the artifact the same run produced recorded that step as
irreversible. The same function, disagreeing with itself across two call sites.

Two causes, both worth keeping.

**The context was the page furniture.** I had passed `observation.text.slice(0, 400)`.
This application renders a persistent shell — crest, nav, breadcrumbs, teller name —
around an inner content frame, and the shell runs well past four hundred characters. The
classifier was being handed the furniture and never reached the screen. Both call sites
now use one `screenText()` helper that takes the content frame's own text, falling back
to the whole observation when there is no child frame. Sharing the helper is the point:
two definitions of "the screen" would drift apart exactly the way these two call sites
just did.

**The recorder was right for the wrong reason.** It classifies on
`` `${label} ${intent}` `` — the model's own sentence is part of the text being matched —
and the model had written "Confirm and post the fee entry", so _post_ matched and the
step came out irreversible. Had it written "Submit the form", the same action would have
been recorded as merely risky. A risk classification that depends on the model's choice
of verb is not a control; it is a coincidence that happens to be load-bearing. The intent
is still a useful signal and still contributes, but the screen is now what decides, and
the screen is not something the model writes.

The general lesson is the one from the frame-offset bug and the detector round-trip: when
two places compute the same thing from different inputs, the one you are not looking at
is the one that is wrong.

## D48 — Two bugs the new write action exposed in the recorder

Teaching the fee capability produced an artifact whose first step was:

```
s1_type   type   {{secret:corelink.password}}   <- into the User ID field
```

`templatize` recovered the placeholder by reverse-mapping the substituted value, and the
fixture's username and password are both `admin`, so the map kept whichever was inserted
last and both credential steps came out as the password. It replayed perfectly — against
a fixture where the two values are equal — and would have failed against any real pair.

The template was never lost; it was simply not carried. The discovery loop already had
`{{secret:corelink.username}}` in hand and logged it, then pushed only the substituted
value into the recorded action. Carrying the template removes the inference instead of
improving it, and value-matching stays as the fallback for actions that have no template,
such as a navigation URL. A test now asserts that two secrets sharing a value stay
distinct, and that no secret's literal reaches the artifact.

The same run produced the second bug, described in [D46](#d46--a-literal-that-is-really-a-mangled-parameter):
a typed literal that was really a fragment of a supplied parameter. Both are the same
mistake at different call sites — reconstructing an input from its output — and both were
invisible because the artifact replayed cleanly.

## D49 — What the mobile sweep is entitled to assert

Adding the posting screen to the visual sweep produced four mobile failures at 630px
against a 390px viewport. Measuring the rest of the application first was what made the
result meaningful: every panel overflows — 670px for search, the member record and the
sub-account form, 910px for both registers — and the new screen is the narrowest of them.
The sweep had simply never pointed at a `/frame/` URL before.

So this was not a regression, and "fixing" it would have been the wrong instinct twice
over. A `/frame/` URL is one panel, not a page; what a person opens is the shell, which
embeds the panel in a scrolling iframe and passes the mobile check like every other
route. And the fixed-width nested tables are the fixture's entire purpose — they are what
the targeting engine exists to cope with. Making them responsive would have made the
target less representative of the software this system is meant to drive.

The overflow rule is now scoped to pages rather than panels, with the measurements
recorded at the waiver so the next person can see it was a decision and not an oversight.
Console errors and screenshots still apply to the panels, which is what those entries are
for.
