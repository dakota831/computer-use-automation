import { config as loadEnv } from "dotenv";
loadEnv({ quiet: true });
import { readFileSync } from "node:fs";
import { Capability } from "../src/core/artifact.js";
import { replay } from "../src/replay/executor.js";
import { redactor } from "../src/core/redact.js";

const cap = Capability.parse(
  JSON.parse(
    readFileSync("artifacts/cu.member.read_savings_balance@1.0.0.json", "utf8"),
  ),
);

const SECRETS: Record<string, string> = {
  "corelink.username": process.env.DEX_TELLER_USER ?? "admin",
  "corelink.password": process.env.DEX_TELLER_PASS ?? "admin",
};
Object.values(SECRETS).forEach((v) => redactor.registerSecret(v));
const secrets = (k: string) => SECRETS[k];

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

const CASES: [string, string][] = [
  ["100001", "happy path"],
  ["999999", "no such member"],
  ["12345", "bad input (5 digits)"],
  ["200001", "permission denied"],
  ["200002", "unexpected interstitial"],
  ["200004", "application error"],
  ["200003", "slow load"],
];

await resetTargetLedger();

for (const [memberId, label] of CASES) {
  const t0 = Date.now();
  const r = await replay(cap, {
    mode: "replay_unattended",
    inputs: { memberId },
    secrets,
    evidenceDir: "/tmp/dex-evidence",
  });
  const ms = Date.now() - t0;
  let detail = "";
  if (r.status === "success") detail = `outputs=${JSON.stringify(r.outputs)}`;
  else if (r.status === "outcome") detail = `${r.outcome.code}`;
  else if (r.status === "failed")
    detail = `${r.failure.code} @${r.failure.stepId ?? "-"}: ${r.failure.message.slice(0, 58)}`;
  else if (r.status === "escalated")
    detail = `intervention ${r.interventionId}`;
  console.log(
    `${memberId}  ${label.padEnd(24)} -> ${r.status.toUpperCase().padEnd(9)} ${detail}  (${ms}ms)`,
  );
}
