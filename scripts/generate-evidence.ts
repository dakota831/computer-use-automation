import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
import {
  rmSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { Capability } from "../src/core/artifact.js";
import { Catalog } from "../src/server/catalog.js";
import { replay } from "../src/replay/executor.js";
import { redactor } from "../src/core/redact.js";

/**
 * Regenerate /evidence/ from scratch: one genuine discovery run plus replays
 * covering each arm of the result contract. Reproducible, so a reviewer can
 * re-run it rather than trusting the committed output.
 *
 * The discovery run is NOT performed here - it costs a model call and is driven
 * by `npm run discover`. This renames and documents whatever the latest
 * discovery run produced, alongside freshly generated replays.
 */

/**
 * Return the target application to its seed before measuring anything.
 *
 * The teller app now has a write action that really moves money, so whatever
 * somebody posted while clicking around would otherwise show up in the numbers
 * this script prints and commits. Resetting first is what keeps the evidence
 * reproducible rather than a snapshot of the app's mood.
 */
async function resetTargetLedger(): Promise<void> {
  const base = process.env.DEX_APP_BASE ?? "http://127.0.0.1:8080";
  for (const tenant of ["firstcu", "summit"]) {
    try {
      await fetch(`${base}/t/${tenant}/admin/reset-ledger`, { method: "POST" });
    } catch {
      // The app may not be up yet; the run below will fail with a clearer
      // message than anything this could report.
    }
  }
}

const SECRETS: Record<string, string> = {
  "corelink.username": process.env.DEX_TELLER_USER ?? "admin",
  "corelink.password": process.env.DEX_TELLER_PASS ?? "admin",
};
Object.values(SECRETS).forEach((v) => redactor.registerSecret(v));
const secrets = (k: string) => SECRETS[k];

const EV = "evidence";
await resetTargetLedger();

const catalog = new Catalog("artifacts").load();
const baseline = catalog.find("cu.member.read_savings_balance")!.capability;

/**
 * Preserve the discovery run, delete the rest.
 *
 * The discovery run is the only evidence here that costs a model call to
 * produce, so it is treated as precious: both the raw `discovery-<ts>` form and
 * the renamed `01-discovery-llm-run` are protected. An earlier version matched
 * only the raw prefix, so re-running this script silently destroyed the very
 * artifact it was supposed to keep.
 */
const DISCOVERY_DIR = "01-discovery-llm-run";
const isDiscovery = (d: string) =>
  d === DISCOVERY_DIR || d.startsWith("discovery-");

const existing = readdirSync(EV).filter(isDiscovery).sort();
// Prefer an already-canonical directory; otherwise take the newest raw run.
const keep = existing.includes(DISCOVERY_DIR)
  ? DISCOVERY_DIR
  : existing[existing.length - 1];

for (const d of readdirSync(EV)) {
  if (d === keep || d === "README.md") continue;
  rmSync(`${EV}/${d}`, { recursive: true, force: true });
}
if (keep && keep !== DISCOVERY_DIR) {
  renameSync(`${EV}/${keep}`, `${EV}/${DISCOVERY_DIR}`);
}
if (!existsSync(`${EV}/${DISCOVERY_DIR}`)) {
  console.warn(
    `WARNING: no discovery run present. Run \`npm run discover\` to produce one.`,
  );
}

type Case = {
  dir: string;
  label: string;
  inputs: Record<string, unknown>;
  cap: Capability;
  expect: string;
  /** Replay the same artifact against a different institution's install. */
  tenant?: string;
};
const cases: Case[] = [
  {
    dir: "02-replay-success",
    label: "happy path",
    cap: baseline,
    inputs: { memberId: "100001" },
    expect: "success",
  },
  {
    dir: "03-replay-business-outcome",
    label: "no such member",
    cap: baseline,
    inputs: { memberId: "999999" },
    expect: "outcome",
  },
  {
    dir: "04-replay-permission-denied",
    label: "permission denied",
    cap: baseline,
    inputs: { memberId: "200001" },
    expect: "outcome",
  },
  {
    dir: "05-replay-recovered-interstitial",
    label: "unexpected interstitial, recovered",
    cap: baseline,
    inputs: { memberId: "200002" },
    expect: "success",
  },
  {
    dir: "06-replay-hard-failure",
    label: "application error",
    cap: baseline,
    inputs: { memberId: "200004" },
    expect: "failed",
  },
  {
    dir: "07-replay-input-rejected",
    label: "malformed input, rejected before launch",
    cap: baseline,
    inputs: { memberId: "12345" },
    expect: "failed",
  },
  // Cross-tenant: the same artifact, recorded against First Community, applied
  // to Summit - different host, different field labels, an extra interstitial.
  {
    dir: "08-replay-cross-tenant-summit",
    label: "same artifact on a second institution",
    cap: baseline,
    inputs: { memberId: "100001" },
    expect: "success",
    tenant: "summit",
  },
];

const rows: string[] = [];
for (const c of cases) {
  rmSync(`${EV}/${c.dir}`, { recursive: true, force: true });
  const r = await replay(c.cap, {
    mode: "replay_unattended",
    inputs: c.inputs,
    secrets,
    evidenceDir: EV,
    ...(c.tenant ? { tenant: c.tenant } : {}),
  });
  // The logger names the directory by runId; rename to something a reviewer can read.
  const produced = readdirSync(EV)
    .filter((d) => d.startsWith("replay-"))
    .sort();
  const last = produced[produced.length - 1];
  if (last) renameSync(`${EV}/${last}`, `${EV}/${c.dir}`);
  const detail =
    r.status === "success"
      ? JSON.stringify(r.outputs)
      : r.status === "outcome"
        ? r.outcome.code
        : r.status === "failed"
          ? r.failure.code
          : "";
  const ok = r.status === c.expect ? "ok" : `UNEXPECTED (wanted ${c.expect})`;
  rows.push(
    `| \`${c.dir}\` | ${c.label} | \`${r.status}\` | ${detail} | ${ok} |`,
  );
  console.log(`${c.dir.padEnd(34)} ${r.status.padEnd(8)} ${detail}`);
}

writeFileSync(
  `${EV}/README.md`,
  `# Evidence

Regenerate with \`npm run evidence\` (requires the target app running; the discovery
run is produced separately by \`npm run discover\`).

Every run directory contains:

- \`run.jsonl\` — the structured event log: every action, policy verdict, locator
  resolution with the strategy index actually used, checkpoint, and outcome detection
- \`summary.json\` — the result plus redaction counters for that run
- \`screenshots/\` and \`ax/\` — richer signal captured on failure

All data is synthetic. Redaction is applied on the write path, so no credential appears
in any file here.

## Runs

| directory | scenario | status | detail | |
|---|---|---|---|---|
${rows.join("\n")}

\`01-discovery-llm-run\` is a genuine LLM-driven run against the live target app
(NVIDIA NIM, \`openai/gpt-oss-20b\`). It produced
\`artifacts/cu.member.lookup_savings@1.0.0.json\` — note its \`status: "draft"\` and empty
outcome table, which is the point made in REPORT.md §7: one happy-path run cannot know
what the error states look like.

## The distinction that matters

\`03\` and \`04\` are **business outcomes**, not failures. The application answered the
question correctly and the caller needs that answer. \`06\` and \`07\` are genuine
failures. Conflating them is the mistake the brief calls out, and the result contract
makes it unrepresentable — \`BusinessOutcome\` is not an \`Error\` subclass and cannot be
thrown. The CLI carries it to exit codes: outcomes exit 0, failures exit 1.

\`05\` shows a recoverable condition: an unexpected verification interstitial is detected,
dismissed, and the run continues to success without a human.
`,
  "utf8",
);
console.log(`\nwrote ${EV}/README.md`);
