# Decision log

Running notes, newest last. Each entry: what was decided, the alternative, and why.
This is the raw material for REPORT.md — it exists so the reasoning is captured at
the moment of the decision rather than reconstructed afterwards.

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
