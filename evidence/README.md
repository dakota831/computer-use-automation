# Evidence

Regenerate with `npm run evidence` (requires the target app running; the discovery
run is produced separately by `npm run discover`).

Every run directory contains:

- `run.jsonl` — the structured event log: every action, policy verdict, locator
  resolution with the strategy index actually used, checkpoint, and outcome detection
- `summary.json` — the result plus redaction counters for that run
- `screenshots/` and `ax/` — richer signal captured on failure

All data is synthetic. Redaction is applied on the write path, so no credential appears
in any file here.

## Runs

| directory                          | scenario                                           | status    | detail                                                                                                             |     |
| ---------------------------------- | -------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ | --- |
| `02-replay-success`                | happy path                                         | `success` | {"savingsBalance":8214.55,"memberName":"Alina Marsh"}                                                              | ok  |
| `03-replay-business-outcome`       | no such member                                     | `outcome` | MEMBER_NOT_FOUND                                                                                                   | ok  |
| `04-replay-permission-denied`      | permission denied                                  | `outcome` | PERMISSION_DENIED                                                                                                  | ok  |
| `05-replay-recovered-interstitial` | unexpected interstitial, recovered                 | `success` | {"savingsBalance":305.25,"memberName":"Dana Whitfield"}                                                            | ok  |
| `06-replay-hard-failure`           | application error                                  | `failed`  | APP_ERROR                                                                                                          | ok  |
| `07-replay-input-rejected`         | malformed input, rejected before launch            | `failed`  | INPUT_INVALID                                                                                                      | ok  |
| `08-replay-cross-tenant-summit`    | same artifact on a second institution              | `success` | {"savingsBalance":8214.55,"memberName":"Alina Marsh"}                                                              | ok  |
| `09-replay-escalated-handoff`      | irreversible step pauses for a human, who approves | `success` | {"reference":"ADJ-7201","resulting_balance":8213.56} — paused at s6_click (irreversible), s10_click (irreversible) | ok  |

`01-discovery-llm-run` is a genuine LLM-driven run against the live target app
(NVIDIA NIM). It produced
`artifacts/cu.member.lookup_savings@1.0.0.json` — note its `status: "draft"` and empty
outcome table, which is the point made in REPORT.md §7: one happy-path run cannot know
what the error states look like.

`09-replay-escalated-handoff` is requirement 3.6 end to end. The capability it
replays posts a fee, so two of its steps are classified irreversible and the policy
requires confirmation at that level. The run does not fail and does not proceed: it
parks on a live session, the operator answers, and it resumes on the same session with
cookies and position intact. Grep the log for `escalation_raised` and
`control_transferred` — the lease change is recorded in the same stream as the
automation's own actions, which is what would let a handoff become a proposed amendment
to the capability rather than an escalation that repeats forever.

Note that this happens on **every** replay, not only the first. An irreversible step is
not a gate the capability passes once.

## The distinction that matters

`03` and `04` are **business outcomes**, not failures. The application answered the
question correctly and the caller needs that answer. `06` and `07` are genuine
failures. Conflating them is the mistake the brief calls out, and the result contract
makes it unrepresentable — `BusinessOutcome` is not an `Error` subclass and cannot be
thrown. The CLI carries it to exit codes: outcomes exit 0, failures exit 1.

`05` shows a recoverable condition: an unexpected verification interstitial is detected,
dismissed, and the run continues to success without a human.
