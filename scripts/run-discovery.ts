import { config as loadEnv } from "dotenv";
// quiet: this CLI writes JSON to stdout, and a dotenv banner makes it unparseable.
loadEnv({ quiet: true });
import { writeFileSync, mkdirSync } from "node:fs";
import { discover } from "../src/agent/loop.js";

/**
 * One genuine LLM-driven discovery run against the live target app.
 * Produces a draft capability artifact plus a full evidence trail.
 */

const APP = process.env.DEX_APP_BASE ?? "http://127.0.0.1:8080";
const TENANT = process.env.DEX_TENANT ?? "firstcu";
const MEMBER_ID = process.env.DEX_MEMBER_ID ?? "100001";

const apiKey = process.env.NVIDIA_API_KEY;
if (!apiKey) throw new Error("NVIDIA_API_KEY is not set (see .env.example)");

const result = await discover({
  goal: `Sign in to the teller console, look up the member whose ID is {{memberId}}, open their record, and read two values from it: their savings balance and their name.`,
  entryPoint: `${APP}/t/${TENANT}`,
  capabilityId: "cu.member.lookup_savings",
  title: "Look up a member's savings balance",
  description:
    "Signs in to the teller console, searches for a member by ID, opens the record and returns the savings balance and member name. Read-only.",
  vendorApp: "corelink-teller",
  tenant: "base",
  allowedOrigins: [`${APP}/t/${TENANT}/*`],
  parameters: {
    memberId: {
      value: MEMBER_ID,
      spec: {
        type: "string",
        required: true,
        description: "Six-digit member number to look up.",
        sensitivity: "pii",
        pattern: "^\\d{6}$",
        example: "100001",
      },
    },
  },
  secrets: {
    "corelink.username": process.env.DEX_TELLER_USER ?? "admin",
    "corelink.password": process.env.DEX_TELLER_PASS ?? "admin",
  },
  model: process.env.DEX_MODEL ?? "openai/gpt-oss-20b",
  apiKey,
  baseUrl: process.env.NVIDIA_BASE_URL,
  maxSteps: Number(process.env.DEX_MAX_STEPS ?? 22),
  perMinute: Number(process.env.DEX_RATE_LIMIT_PER_MIN ?? 49),
  minSpacingMs: Number(process.env.DEX_MIN_REQUEST_SPACING_MS ?? 1300),
  evidenceDir: process.env.DEX_EVIDENCE_DIR ?? "evidence",
});

mkdirSync("artifacts", { recursive: true });
const path = `artifacts/${result.capability.id}@${result.capability.version}.json`;
writeFileSync(path, JSON.stringify(result.capability, null, 2) + "\n", "utf8");

console.log("");
console.log("DISCOVERY COMPLETE");
console.log(`  run          ${result.runId}`);
console.log(`  model calls  ${result.modelCalls}`);
console.log(`  duration     ${(result.durationMs / 1000).toFixed(1)}s`);
console.log(`  steps        ${result.steps}`);
console.log(
  `  inputs       ${result.capability.inputs.map((i) => `${i.name}:${i.type}`).join(", ") || "-"}`,
);
console.log(
  `  outputs      ${result.capability.outputs.map((o) => `${o.name}:${o.type}`).join(", ") || "-"}`,
);
console.log(`  status       ${result.capability.status}`);
console.log(`  artifact     ${path}`);
console.log(`  evidence     ${result.evidenceDir}`);
