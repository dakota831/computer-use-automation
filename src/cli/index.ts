import { config as loadEnv } from "dotenv";
// quiet: this CLI writes JSON to stdout, and a dotenv banner makes it unparseable.
loadEnv({ quiet: true });
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { Capability } from "../core/artifact.js";
import { redactor } from "../core/redact.js";
import { replay } from "../replay/executor.js";
import { discover } from "../agent/loop.js";
import { Catalog } from "../server/catalog.js";

/**
 * CLI. Uses node:util parseArgs rather than a dependency - four commands do not
 * justify one.
 */

const SECRETS: Record<string, string> = {
  "corelink.username": process.env.DEX_TELLER_USER ?? "admin",
  "corelink.password": process.env.DEX_TELLER_PASS ?? "admin",
};
for (const v of Object.values(SECRETS)) redactor.registerSecret(v);
const secrets = (k: string) => SECRETS[k];

const USAGE = `
computer-use-automation

  discover  --goal <text> [--entry <url>] [--id <capability.id>] [--member <id>] [--model <name>]
            Run the LLM-driven discovery loop and save a draft capability.
            Requires NVIDIA_API_KEY.

  replay    <capability-id[@version]> --input k=v [...] [--attended] [--tenant <id>]
            Replay a saved capability. No model is involved.
            --tenant applies that tenant's override to a base capability.

  catalog   [--tools] [--drafts]
            List saved capabilities, or emit agent tool definitions.

  serve     Start the capability API and operator console backend.
`;

const cmd = process.argv[2];
const argv = process.argv.slice(3);

/** --input memberId=100001 --input nickname="Vacation Fund" */
function parseInputs(pairs: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const i = p.indexOf("=");
    if (i < 0) throw new Error(`--input expects key=value, got "${p}"`);
    out[p.slice(0, i)] = p.slice(i + 1);
  }
  return out;
}

const loadCapability = (ref: string) => {
  const found = new Catalog(process.env.DEX_ARTIFACT_DIR ?? "artifacts")
    .load()
    .find(ref);
  if (!found)
    throw new Error(`no capability "${ref}" in the artifact directory`);
  return found.capability;
};

switch (cmd) {
  case "replay": {
    const ref = argv[0];
    if (!ref || ref.startsWith("--"))
      throw new Error("replay needs a capability id\n" + USAGE);
    const { values } = parseArgs({
      args: argv.slice(1),
      options: {
        input: { type: "string", multiple: true },
        attended: { type: "boolean" },
        tenant: { type: "string" },
      },
      allowPositionals: false,
    });
    const cap = loadCapability(ref);
    const result = await replay(cap, {
      mode: values.attended ? "replay_attended" : "replay_unattended",
      inputs: parseInputs(values.input ?? []),
      secrets,
      ...(values.tenant ? { tenant: values.tenant } : {}),
      evidenceDir: process.env.DEX_EVIDENCE_DIR ?? "evidence",
    });
    console.log(JSON.stringify(result, null, 2));
    // A business outcome is not an error: it exits 0 with a code the caller reads.
    process.exit(result.status === "failed" ? 1 : 0);
  }

  case "discover": {
    const { values } = parseArgs({
      args: argv,
      options: {
        goal: { type: "string" },
        entry: { type: "string" },
        id: { type: "string" },
        member: { type: "string" },
        model: { type: "string" },
        tenant: { type: "string" },
      },
    });
    const apiKey = process.env.NVIDIA_API_KEY;
    if (!apiKey) throw new Error("NVIDIA_API_KEY is not set; see .env.example");

    const app = process.env.DEX_APP_BASE ?? "http://127.0.0.1:8080";
    const tenant = values.tenant ?? "firstcu";
    const entry = values.entry ?? `${app}/t/${tenant}`;
    const memberId = values.member ?? "100001";

    const r = await discover({
      goal:
        values.goal ??
        "Sign in, look up the member whose ID is {{memberId}}, open their record, and read their savings balance and name.",
      entryPoint: entry,
      capabilityId: values.id ?? "cu.member.lookup_savings",
      title: "Look up a member's savings balance",
      description:
        "Signs in, searches for a member by ID, opens the record and returns the savings balance and member name. Read-only.",
      vendorApp: "corelink-teller",
      tenant: "base",
      allowedOrigins: [`${new URL(entry).origin}/t/${tenant}/*`],
      parameters: {
        memberId: {
          value: memberId,
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
      secrets: SECRETS,
      model: values.model ?? process.env.DEX_MODEL ?? "openai/gpt-oss-20b",
      apiKey,
      baseUrl: process.env.NVIDIA_BASE_URL,
      perMinute: Number(process.env.DEX_RATE_LIMIT_PER_MIN ?? 49),
      minSpacingMs: Number(process.env.DEX_MIN_REQUEST_SPACING_MS ?? 1300),
      evidenceDir: process.env.DEX_EVIDENCE_DIR ?? "evidence",
    });

    mkdirSync("artifacts", { recursive: true });
    const path = `artifacts/${r.capability.id}@${r.capability.version}.json`;
    writeFileSync(path, JSON.stringify(r.capability, null, 2) + "\n", "utf8");
    console.log(
      `discovered in ${r.modelCalls} model calls / ${(r.durationMs / 1000).toFixed(1)}s`,
    );
    console.log(`  artifact  ${path} (status: ${r.capability.status})`);
    console.log(`  evidence  ${r.evidenceDir}`);
    break;
  }

  case "catalog": {
    const { values } = parseArgs({
      args: argv,
      options: { tools: { type: "boolean" }, drafts: { type: "boolean" } },
    });
    const cat = new Catalog(process.env.DEX_ARTIFACT_DIR ?? "artifacts").load();
    if (values.tools) {
      console.log(
        JSON.stringify(
          cat.toolDefinitions({ includeDrafts: values.drafts }),
          null,
          2,
        ),
      );
      break;
    }
    for (const c of cat.summaries()) {
      console.log(`${c.id}@${c.version}  [${c.status}]`);
      console.log(`  ${c.description}`);
      console.log(
        `  in:  ${c.inputs.map((i) => `${i.name}:${i.type}${i.required ? "" : "?"}`).join(", ") || "-"}`,
      );
      console.log(
        `  out: ${c.outputs.map((o) => `${o.name}:${o.type}`).join(", ") || "-"}`,
      );
      console.log(
        `  outcomes: ${c.outcomes.map((o) => o.code).join(", ") || "none declared"}`,
      );
      console.log("");
    }
    break;
  }

  case "serve":
    await import("../server/index.js");
    break;

  default:
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
}
