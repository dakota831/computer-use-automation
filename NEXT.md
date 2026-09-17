# Resume point

Working notes, not a deliverable. Delete before submission.

## Done

- `src/core/` — capability schema, targeting, assertions. Typechecks clean.
- `target-app/` — two-tenant legacy surface. Every scenario verified by curl.
- `DECISIONS.md` — D1..D7, including the AX-tree measurements in D7.
- README.md — setup, tenants, scenario table.

## Blocked on you

**NVIDIA NIM API key** (`nvapi-...` from build.nvidia.com). Write it to
`~/projects/dex/.env` as `NVIDIA_API_KEY=`. Blocks only the discovery run.
Candidate models to probe for tool-calling reliability, best first:
`nvidia/nemotron-3-super-120b-a12b`, `mistralai/mistral-large-2-instruct`,
`openai/gpt-oss-20b`, `nvidia/llama-3.1-nemotron-ultra-253b-v1`.

## Next, in order

1. **`src/surface/`** — the perception layer. This is the next real work.
   - `types.ts`: `Surface` interface (`observe` / `act` / `resolve`). Nothing above
     this line may know Playwright exists.
   - `web.ts`: CDP adapter. Must walk `Page.getFrameTree` for real frame ids (see D7 —
     Playwright's frame handle silently returns the *top* tree), call
     `Accessibility.getFullAXTree({frameId})` per frame, assign stable refs, and
     infer names for unnamed controls from adjacent `LayoutTableCell` text.
2. `src/core/policy.ts`, `redact.ts`, `errors.ts`, `log.ts`
3. `src/replay/` — resolver honouring the ranked strategies, ambiguity = failure,
   outcome detection, result contract
4. `src/agent/` — discovery loop (needs the key)
5. `src/operator/` — control lease, broker, console w/ CDP screencast + input forwarding
6. Evidence runs, tests, REPORT.md

## Environment

- VM `dexdash@69.197.162.108`, key `~/.ssh/interface_ai_vm`, repo `~/projects/dex`
- Start the app: `npm run target` (127.0.0.1:8080)
- `gh` is **not** installed — dpkg lock was held by unattended-upgrades. Retry
  `sudo apt-get install -y gh` before creating the GitHub repo.
- Repo is local-only so far. No GitHub remote yet; will be private, named
  `computer-use-automation`.
- Backup of the previous project: `~/backups/pre-dex-20260917-2333.tar.gz` (60 MB,
  former employer's data — delete when you're sure).
