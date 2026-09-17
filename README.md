# computer-use-automation

Record-once / replay-many UI automation for legacy back-office applications.

An LLM drives a real application surface to accomplish a goal the first time. The
successful run is recorded as a typed, versioned **capability artifact**. That artifact
is then replayed deterministically, with no model in the decision loop, which is how a
calling agent invokes it in production.

> **All data in this repository is synthetic.** The target application is a stand-in
> built for this project. No real institution, member, account or credential is
> represented anywhere in the code, fixtures or evidence.

## Requirements

- Node 22+
- An NVIDIA NIM API key (`nvapi-...`) — **only needed for the discovery run.**
  Replay never calls a model, so the entire replay path runs with no key at all.

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env    # then add your key
```

## The target application

A synthetic back-office app, "CoreLink Teller", deliberately built as a *hostile*
automation surface: an iframe shell, table-based layout, ASP.NET-style generated
control names (`ctl00$MainContent$txtMemberId`), no test IDs, and no `<label for>`
associations. This is the environment the brief describes, and it is materially harder
than a demo site with clean markup — the login fields have no accessible name at all.

```bash
npm run target      # http://127.0.0.1:8080
```

Two tenants run the **same vendor product**, configured differently — the stand-in for
many institutions running one vendor's software:

| | `/t/firstcu` | `/t/summit` |
|---|---|---|
| Institution | First Community CU | Summit Savings Federal CU |
| Version | CoreLink 8.2.1 | CoreLink 8.4.0 |
| ID field label | "Member ID" | "Member Number" |
| Search button | "Search" | "Find" |
| Savings label | "Savings Balance" | "Regular Savings" |
| After login | straight to search | acknowledgement screen first |

Sign in with `teller1` / `demo-teller-pw`.

### Reproducible states

Exceptional states are addressed by member ID, so evidence shows genuine detection
rather than an injected mock:

| Member ID | State | Class |
|---|---|---|
| `100001` `100002` `100003` | normal record | success |
| `999999` | no such member | **business outcome** |
| `abc` (non-numeric) | validation error | **business outcome** |
| `200001` | permission denied | business outcome |
| `200002` | unexpected verification interstitial | **recoverable** |
| `200003` | slow load (~6s) | **recoverable** |
| `200004` | application error, HTTP 500 | **hard failure** |
| — | session expiry (`DEX_SESSION_TTL_MS=1000`) | recoverable (re-auth) |

That three-way split — business outcome vs. recoverable condition vs. hard failure — is
the core of the replay result contract.

## Layout

```
src/core/       capability schema, targeting, assertions   [done]
src/surface/    Surface interface + CDP perception adapter  [next]
src/agent/      discovery loop, model client, recorder
src/replay/     executor, locator resolver, outcome detection
src/operator/   escalation broker + handoff console
target-app/     the synthetic legacy surface                [done]
```

`DECISIONS.md` is the running design log — each entry records what was decided, the
alternative, and why.
