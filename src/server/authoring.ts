import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Capability } from "../core/artifact.js";
import { urlMatchesEntry } from "../core/policy.js";
import {
  discover,
  type DiscoverOptions,
  type ConfirmRequest,
} from "../agent/loop.js";

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

export type DiscoveryTarget = { id: string; label: string; entryPoint: string };

/**
 * The applications discovery may be aimed at, as a closed list.
 *
 * An operator picks an institution by name; they never type a URL. That is
 * friendlier, and it is a tighter control than the origin allowlist — the entry
 * point can only ever be one of these exact values, so there is no traversal or
 * open-redirect surface to reason about.
 */
export function discoveryTargets(): DiscoveryTarget[] {
  const raw = process.env.DEX_DISCOVERY_TARGETS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DiscoveryTarget[];
      if (
        Array.isArray(parsed) &&
        parsed.every((t) => t.id && t.label && t.entryPoint)
      )
        return parsed;
    } catch {
      /* fall through to the default rather than starting with no targets */
    }
  }
  const base = process.env.DEX_APP_BASE ?? "http://127.0.0.1:8080";
  return [
    {
      id: "firstcu",
      label: "First Community Credit Union",
      entryPoint: `${base}/t/firstcu`,
    },
    {
      id: "summit",
      label: "Summit Savings Federal Credit Union",
      entryPoint: `${base}/t/summit`,
    },
  ];
}

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
  /**
   * Set as soon as the run has an id, not on success.
   *
   * The evidence for a failed run is the evidence worth reading, so the link
   * to it has to exist while the run is still going wrong.
   */
  runId?: string;
  modelCalls?: number;
  steps?: number;
  error?: string;
  /** Live progress, updated while status is "running". */
  step?: number;
  maxSteps?: number;
  lastAction?: string;
  /** Absolute ms timestamp the wall-clock budget expires at. */
  deadline?: number;
  /**
   * Set while the run is parked waiting for an operator to allow a risky step.
   *
   * "Running" and "running but waiting on you" are different states, and a
   * progress panel that renders them identically will be watched until the
   * escalation times out.
   */
  awaiting?: { interventionId: string; intent: string; reason: string };
};

const jobs = new Map<string, DiscoveryJob>();
/** Cancellation handles, kept out of the serialised job. */
const cancels = new Map<string, AbortController>();

/**
 * Stop a running discovery.
 *
 * A run can take minutes, and an operator who can see it going nowhere should
 * not have to wait out the budget or restart the service to reclaim it.
 */
export function cancelDiscovery(id: string): boolean {
  const ctl = cancels.get(id);
  if (!ctl || jobs.get(id)?.status !== "running") return false;
  ctl.abort();
  return true;
}

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
  /**
   * Illustrative values for each `{{name}}` the goal references. The recorder
   * templatises them back out, so they shape the run without being baked in.
   */
  parameters?: { name: string; value: string; description?: string }[];
  model?: string;
  maxSteps?: number;
};

/**
 * Host-supplied capabilities the authoring module deliberately does not own.
 *
 * Whether there is a human to ask is a property of how discovery was started,
 * not of discovery. The CLI passes nothing and keeps the unattended refusal.
 */
export type DiscoveryHooks = {
  onConfirm?: (c: ConfirmRequest, job: DiscoveryJob) => Promise<boolean>;
};

export function startDiscovery(
  input: StartDiscoveryInput,
  secrets: Record<string, string>,
  hooks: DiscoveryHooks = {},
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
  // Must be one of the offered applications exactly, and still satisfy the
  // origin allowlist. The first is the real control; the second is defence in
  // depth against a badly configured target list.
  if (!discoveryTargets().some((t) => t.entryPoint === input.entryPoint)) {
    return { error: "entry point is not one of the configured applications" };
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
    step: 0,
  };
  jobs.set(id, job);
  const ctl = new AbortController();
  cancels.set(id, ctl);

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
    parameters: Object.fromEntries(
      (input.parameters ?? [])
        .filter((p) => p.name.trim())
        .map((p) => [
          p.name.trim(),
          {
            value: p.value ?? "",
            spec: {
              type: "string" as const,
              required: true,
              description:
                p.description ?? `${p.name.trim()} supplied per invocation.`,
              // Anything an operator supplies about a member is PII unless
              // someone deliberately says otherwise during review.
              sensitivity: "pii" as const,
              example: p.value ?? "",
            },
          },
        ]),
    ),
    secrets,
    model: input.model ?? process.env.DEX_MODEL ?? "openai/gpt-oss-20b",
    apiKey,
    baseUrl: process.env.NVIDIA_BASE_URL,
    maxSteps: input.maxSteps ?? 25,
    signal: ctl.signal,
    ...(hooks.onConfirm
      ? {
          onConfirm: async (c: ConfirmRequest) => {
            try {
              return await hooks.onConfirm!(c, job);
            } finally {
              delete job.awaiting;
            }
          },
        }
      : {}),
    onProgress: (p) =>
      Object.assign(job, {
        runId: p.runId,
        step: p.step,
        maxSteps: p.maxSteps,
        lastAction: p.lastAction,
        deadline: p.deadline,
      }),
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
        // An operator who pressed Stop should read that, not whichever
        // internal call happened to notice the abort first.
        error: ctl.signal.aborted
          ? "Stopped by the operator."
          : String(e).slice(0, 400),
      });
    })
    .finally(() => cancels.delete(id));

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
