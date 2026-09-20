import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Capability } from "../core/artifact.js";
import { urlMatchesEntry } from "../core/policy.js";
import { discover, type DiscoverOptions } from "../agent/loop.js";

/**
 * Authoring: running discovery on demand, and editing what it produced.
 *
 * This closes the loop the rest of the system only describes. A discovery run
 * emits a draft, because one happy-path pass cannot know what the error states
 * look like. Somebody then has to read it, add the outcome table, and approve
 * it — and if that can only be done by hand-editing JSON over SSH, it will not
 * happen. So it is a first-class operation here.
 *
 * Discovery is bounded by an allowlist of its own. The console is behind auth,
 * but "authenticated user can point an LLM-driven browser at any URL" is a
 * capability worth constraining separately from "authenticated user can read
 * the catalog".
 */

const ARTIFACTS = () => process.env.DEX_ARTIFACT_DIR ?? "artifacts";

/** Where discovery is permitted to be aimed. Not the same as a capability's own policy. */
export const discoveryOrigins = (): string[] =>
  (process.env.DEX_DISCOVERY_ALLOWED_ORIGINS ?? "http://127.0.0.1:8080")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export type JobStatus = "running" | "succeeded" | "failed";

export type DiscoveryJob = {
  id: string;
  status: JobStatus;
  goal: string;
  entryPoint: string;
  startedAt: string;
  finishedAt?: string;
  /** Present on success. */
  capabilityId?: string;
  version?: string;
  artifactPath?: string;
  runId?: string;
  modelCalls?: number;
  steps?: number;
  error?: string;
};

const jobs = new Map<string, DiscoveryJob>();

export const listJobs = (): DiscoveryJob[] =>
  [...jobs.values()]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 25);
export const getJob = (id: string): DiscoveryJob | undefined => jobs.get(id);

export type StartDiscoveryInput = {
  goal: string;
  entryPoint: string;
  capabilityId: string;
  title: string;
  description: string;
  vendorApp?: string;
  /** Single illustrative parameter; the recorder templatises it out of the run. */
  paramName?: string;
  paramValue?: string;
  paramDescription?: string;
  model?: string;
  maxSteps?: number;
};

export function startDiscovery(
  input: StartDiscoveryInput,
  secrets: Record<string, string>,
): { job: DiscoveryJob } | { error: string } {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey)
    return { error: "NVIDIA_API_KEY is not configured on the server" };

  if (!/^[a-z][a-z0-9_.]*$/.test(input.capabilityId)) {
    return {
      error:
        "capabilityId must be lowercase dotted identifier, e.g. cu.member.lookup",
    };
  }
  if (!discoveryOrigins().some((o) => urlMatchesEntry(input.entryPoint, o))) {
    return {
      error: `entry point is outside the discovery allowlist [${discoveryOrigins().join(", ")}]`,
    };
  }

  const id = `job_${randomUUID().slice(0, 8)}`;
  const job: DiscoveryJob = {
    id,
    status: "running",
    goal: input.goal,
    entryPoint: input.entryPoint,
    startedAt: new Date().toISOString(),
  };
  jobs.set(id, job);

  const origin = new URL(input.entryPoint).origin;
  const path = new URL(input.entryPoint).pathname.replace(/\/$/, "");

  const opts: DiscoverOptions = {
    goal: input.goal,
    entryPoint: input.entryPoint,
    capabilityId: input.capabilityId,
    title: input.title,
    description: input.description,
    vendorApp: input.vendorApp ?? "corelink-teller",
    tenant: "base",
    // Scope the agent to the entry point's own path, not the whole origin.
    allowedOrigins: [`${origin}${path}/*`],
    parameters: input.paramName
      ? {
          [input.paramName]: {
            value: input.paramValue ?? "",
            spec: {
              type: "string",
              required: true,
              description:
                input.paramDescription ??
                `${input.paramName} supplied per invocation.`,
              sensitivity: "pii",
              example: input.paramValue ?? "",
            },
          },
        }
      : {},
    secrets,
    model: input.model ?? process.env.DEX_MODEL ?? "openai/gpt-oss-20b",
    apiKey,
    baseUrl: process.env.NVIDIA_BASE_URL,
    maxSteps: input.maxSteps ?? 22,
    timeoutMs: Number(process.env.DEX_DISCOVERY_TIMEOUT_MS ?? 5 * 60_000),
    perMinute: Number(process.env.DEX_RATE_LIMIT_PER_MIN ?? 49),
    minSpacingMs: Number(process.env.DEX_MIN_REQUEST_SPACING_MS ?? 1300),
    evidenceDir: process.env.DEX_EVIDENCE_DIR ?? "evidence",
  };

  // Fire and forget; the caller polls. A discovery run takes tens of seconds
  // and holding an HTTP request open for it buys nothing.
  void discover(opts)
    .then((r) => {
      mkdirSync(ARTIFACTS(), { recursive: true });
      const p = join(
        ARTIFACTS(),
        `${r.capability.id}@${r.capability.version}.json`,
      );
      writeFileSync(p, JSON.stringify(r.capability, null, 2) + "\n", "utf8");
      Object.assign(job, {
        status: "succeeded" as JobStatus,
        finishedAt: new Date().toISOString(),
        capabilityId: r.capability.id,
        version: r.capability.version,
        artifactPath: p,
        runId: r.runId,
        modelCalls: r.modelCalls,
        steps: r.steps,
      });
    })
    .catch((e) => {
      Object.assign(job, {
        status: "failed" as JobStatus,
        finishedAt: new Date().toISOString(),
        error: String(e).slice(0, 400),
      });
    });

  return { job };
}

export type SaveResult =
  | { ok: true; path: string; id: string; version: string }
  | { ok: false; error: string };

/**
 * Persist an edited capability.
 *
 * Validated against the same Zod schema the replay engine parses with, so the
 * console cannot write an artifact the executor would reject at runtime — the
 * failure happens at save time, where a human is present to read it.
 *
 * Writing under a new version creates a new file rather than overwriting, which
 * makes "edit an approved capability" naturally a new reviewable artifact
 * instead of a silent mutation of something already running in production.
 */
export function saveCapability(
  raw: unknown,
  opts: { allowOverwrite?: boolean } = {},
): SaveResult {
  const parsed = Capability.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      error: `${parsed.error.issues.length} schema error(s). First: ${first?.path.join(".") || "(root)"} — ${first?.message}`,
    };
  }
  const cap = parsed.data;
  mkdirSync(ARTIFACTS(), { recursive: true });
  const path = join(ARTIFACTS(), `${cap.id}@${cap.version}.json`);
  if (existsSync(path) && opts.allowOverwrite === false) {
    return {
      ok: false,
      error: `${cap.id}@${cap.version} already exists; bump the version`,
    };
  }
  writeFileSync(path, JSON.stringify(cap, null, 2) + "\n", "utf8");
  return { ok: true, path, id: cap.id, version: cap.version };
}
