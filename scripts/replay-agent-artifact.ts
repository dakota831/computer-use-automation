import { config as loadEnv } from "dotenv";
// quiet: this CLI writes JSON to stdout, and a dotenv banner makes it unparseable.
loadEnv({ quiet: true });
import { readFileSync } from "node:fs";
import { Capability } from "../src/core/artifact.js";
import { replay } from "../src/replay/executor.js";
import { redactor } from "../src/core/redact.js";

const cap = Capability.parse(
  JSON.parse(
    readFileSync("artifacts/cu.member.lookup_savings@1.0.0.json", "utf8"),
  ),
);
const SECRETS: Record<string, string> = {
  "corelink.username": process.env.DEX_TELLER_USER ?? "teller1",
  "corelink.password": process.env.DEX_TELLER_PASS ?? "demo-teller-pw",
};
Object.values(SECRETS).forEach((v) => redactor.registerSecret(v));
const secrets = (k: string) => SECRETS[k];

const show = (label: string, r: any) => {
  const detail =
    r.status === "success"
      ? JSON.stringify(r.outputs)
      : r.status === "outcome"
        ? r.outcome.code
        : r.status === "failed"
          ? `${r.failure.code}: ${r.failure.message.slice(0, 60)}`
          : r.interventionId;
  console.log(
    `  ${label.padEnd(42)} -> ${r.status.toUpperCase().padEnd(9)} ${detail}`,
  );
};

console.log(`capability ${cap.id}@${cap.version}  status=${cap.status}`);
console.log(
  `discovered by ${cap.provenance.discoveredBy.provider}/${cap.provenance.discoveredBy.model}\n`,
);

// The approval gate: a draft capability may not run unattended.
show(
  "unattended (draft, expect refusal)",
  await replay(cap, {
    mode: "replay_unattended",
    inputs: { memberId: "100001" },
    secrets,
    evidenceDir: "evidence",
  }),
);

// Attended replay of the same draft is allowed.
show(
  "attended, memberId=100001",
  await replay(cap, {
    mode: "replay_attended",
    inputs: { memberId: "100001" },
    secrets,
    evidenceDir: "evidence",
  }),
);

// A different input proves the flow generalised rather than memorising the run.
show(
  "attended, memberId=100003",
  await replay(cap, {
    mode: "replay_attended",
    inputs: { memberId: "100003" },
    secrets,
    evidenceDir: "evidence",
  }),
);

// And a business outcome the agent never saw during discovery.
show(
  "attended, memberId=999999",
  await replay(cap, {
    mode: "replay_attended",
    inputs: { memberId: "999999" },
    secrets,
    evidenceDir: "evidence",
  }),
);
