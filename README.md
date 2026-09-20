# computer-use-automation

Record-once / replay-many UI automation for legacy back-office applications.

An LLM drives a real application surface to accomplish a goal the first time. The
successful run is recorded as a typed, versioned **capability artifact**. That artifact is
then replayed deterministically, with no model in the decision loop, which is how a
calling agent invokes it in production.

**The design write-up is [REPORT.md](REPORT.md).** `DECISIONS.md` is the running log of
why each choice was made, including the bugs that produced several of them.

> **All data here is synthetic.** The target application is a stand-in built for this
> project. No real institution, member, account or credential is represented anywhere in
> the code, fixtures or evidence.

---

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env     # add NVIDIA_API_KEY for discovery only
```

**Node 22+.** An NVIDIA NIM API key is needed *only* for the discovery run. Replay never
calls a model and the target app is local, so **the entire replay path runs with no key
and no network access.**

---

## Demo path

Three terminals, or `npm run dev` to start all of it at once.

```bash
# 1. the synthetic legacy application
npm run target                      # http://127.0.0.1:8080
```

```bash
# 2. an LLM-driven discovery run  (needs NVIDIA_API_KEY)
npm run discover
#   -> artifacts/cu.member.lookup_savings@1.0.0.json   (status: draft)
#   -> evidence/discovery-.../run.jsonl
```

```bash
# 3. deterministic replay of a saved capability  (no model involved)
npx tsx src/cli/index.ts replay cu.member.read_savings_balance --input memberId=100001
#   {"status":"success","outputs":{"savingsBalance":8214.55,"memberName":"Alina Marsh"}}

npx tsx src/cli/index.ts replay cu.member.read_savings_balance --input memberId=999999
#   {"status":"outcome","outcome":{"code":"MEMBER_NOT_FOUND",...}}     exits 0 - not a failure

npx tsx src/cli/index.ts replay cu.member.read_savings_balance --input memberId=200004
#   {"status":"failed","failure":{"code":"APP_ERROR",...}}             exits 1
```

```bash
# 4. the human-in-the-loop handoff, end to end
npm run serve                                    # in one terminal
npx tsx scripts/demo-handoff.ts                  # in another
```

That last one invokes a capability whose final step creates an account. Replay refuses to
perform it unattended, escalates, a named operator attaches to the **live session** over a
CDP screencast, is refused input until taking the control lease, takes it, approves, and
the run resumes and completes.

```bash
npm run evidence     # regenerate /evidence/ from scratch
npm test             # 42 unit tests
npm run typecheck
```

---

## CLI

```
discover  --goal <text> [--entry <url>] [--member <id>] [--model <name>]
replay    <capability-id[@version]> --input k=v [--input k=v ...] [--attended]
catalog   [--tools] [--drafts]
serve
```

`catalog --tools` emits function-calling tool definitions generated from the same
`ParamSpec` the replay engine validates against, so an agent that satisfies the schema
cannot then fail input validation. Only `approved` capabilities are offered unless
`--drafts` is passed.

---

## The target application

A synthetic back-office app, "CoreLink Teller", deliberately built as a *hostile*
automation surface: an iframe shell, table-based layout, ASP.NET-style generated control
names (`ctl00$MainContent$txtMemberId`), no test IDs, and no `<label for>` associations
anywhere.

That last point is not decoration. Measured against it, **the login fields have no
accessible name at all** — role `textbox`, empty name, with "User ID:" beside them as a
separate table cell. A system built only on role+name could not log in. See REPORT.md §4.

Two tenants run the **same vendor product**, configured differently:

| | `/t/firstcu` | `/t/summit` |
|---|---|---|
| Institution | First Community CU | Summit Savings Federal CU |
| Version | CoreLink 8.2.1 | CoreLink 8.4.0 |
| ID field label | "Member ID" | "Member Number" |
| Search button | "Search" | "Find" |
| Savings label | "Savings Balance" | "Regular Savings" |
| After login | straight to search | acknowledgement screen first |

Sign in with `admin` / `admin`.

### Reproducible states

Exceptional states are addressed by member ID, so the evidence shows genuine detection
rather than an injected mock:

| Member ID | State | Class |
|---|---|---|
| `100001` `100002` `100003` | normal record | success |
| `999999` | no such member | **business outcome** |
| `200001` | permission denied | **business outcome** |
| `200002` | unexpected verification interstitial | **recoverable** |
| `200003` | slow load (~6s) | **recoverable** |
| `200004` | application error, HTTP 500 | **hard failure** |
| `12345` | malformed input | hard failure, before a browser launches |
| — | session expiry (`DEX_SESSION_TTL_MS=1000`) | recoverable (re-auth) |

---

## Layout

```
src/core/      capability schema, error taxonomy, policy, redaction, run log
src/surface/   Surface interface + CDP web adapter      <- the portability seam
src/agent/     discovery loop, NIM client, recorder
src/replay/    executor, locator resolver, outcome detection
src/server/    control lease, escalation registry, catalog API
src/cli/       discover | replay | catalog | serve
web/           operator console (React + Vite + Tailwind)
target-app/    the synthetic legacy surface
artifacts/     saved capabilities
evidence/      run logs, screenshots, accessibility snapshots
deploy/        nginx vhosts and systemd units for the reference deployment
```

Nothing above `src/surface/types.ts` imports Playwright or CDP. That is the seam a
desktop adapter would implement.

---

## Configuration

| variable | purpose |
|---|---|
| `NVIDIA_API_KEY` | discovery only; replay needs no key |
| `DEX_MODEL` | default `openai/gpt-oss-20b` |
| `DEX_RATE_LIMIT_PER_MIN` / `DEX_MIN_REQUEST_SPACING_MS` | provider rate limiting, enforced inside the client |
| `DEX_TARGET_PORT` / `DEX_OPERATOR_PORT` | default 8080 / 4000 |
| `DEX_TELLER_USER` / `DEX_TELLER_PASS` | target-app credentials, resolved at act time and never logged |

Secrets are referenced in artifacts as `{{secret:corelink.password}}` and substituted at
the moment of typing. The model never sees a credential and no artifact contains one.
