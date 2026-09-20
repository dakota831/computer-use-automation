/**
 * Typed client for the operator/catalog API.
 *
 * Hand-mirrored from the server contract. The obvious improvement is to
 * generate these from the same Zod schemas the server validates with, so the
 * console cannot drift from the API - noted in REPORT.md under Cuts.
 */

export type ControlOwner = "automation" | "operator";
export type InterventionStatus =
  "pending" | "operator_controlling" | "resolved";

export type LeaseEvent = {
  at: string;
  from: ControlOwner;
  to: ControlOwner;
  actor: string;
  reason: string;
};

export type HumanAction = {
  at: string;
  kind: "click" | "key" | "note";
  detail: Record<string, unknown>;
};

export type Intervention = {
  id: string;
  runId: string;
  capabilityId: string;
  version: string;
  goal: string;
  stepId: string;
  stepIntent: string;
  reason: string;
  raisedAt: string;
  status: InterventionStatus;
  url: string;
  screenshotPath?: string;
  humanActions: HumanAction[];
  owner: ControlOwner;
  holder: string;
  leaseHistory: LeaseEvent[];
};

export type CapabilitySummary = {
  id: string;
  version: string;
  title: string;
  description: string;
  status: "draft" | "approved" | "deprecated";
  tenant: string;
  vendorApp: string;
  steps: number;
  inputs: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  outputs: { name: string; type: string; description: string }[];
  outcomes: { code: string; disposition: string; describedAs: string }[];
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} -> ${r.status}`);
  return r.json() as Promise<T>;
}

export type ReleaseAction = "resume" | "step_completed" | "abandon";

export const api = {
  interventions: () => get<Intervention[]>("/api/interventions"),
  intervention: (id: string) => get<Intervention>(`/api/interventions/${id}`),
  takeControl: (id: string, actor = "operator") =>
    post<Intervention>(`/api/interventions/${id}/take`, { actor }),
  releaseControl: (
    id: string,
    action: ReleaseAction,
    note: string,
    actor = "operator",
  ) =>
    post<Intervention>(`/api/interventions/${id}/release`, {
      action,
      note,
      actor,
    }),
  capabilities: () => get<CapabilitySummary[]>("/api/capabilities"),
  invoke: (ref: string, inputs: Record<string, unknown>) =>
    post<unknown>(`/api/capabilities/${ref}/invoke`, { inputs }),
};

/* ------------------------------------------------------------ evidence ---- */

export type RunSummary = {
  id: string;
  mode: "discovery" | "replay" | "unknown";
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  capabilityId: string | null;
  events: number;
  screenshots: number;
  detail: string | null;
};

export type RunEvent = Record<string, unknown> & {
  ts: string;
  seq: number;
  kind: string;
  stepId?: string;
};

export type Stats = {
  ok: boolean;
  capabilities: number;
  approved: number;
  drafts: number;
  interventions: number;
  runs: number;
  byStatus: Record<string, number>;
  lastRunAt: string | null;
  discoveryRuns: number;
};

/** Full capability document, for the detail view. */
export type CapabilityDoc = {
  id: string;
  version: string;
  title: string;
  description: string;
  status: string;
  tenant: string;
  surface: {
    kind: string;
    entryPoint: string;
    appProfile: { vendorApp: string; versionRange: string };
  };
  inputs: {
    name: string;
    type: string;
    required: boolean;
    description: string;
    sensitivity: string;
    pattern?: string;
    example?: string;
  }[];
  outputs: {
    name: string;
    type: string;
    description: string;
    sensitivity: string;
  }[];
  steps: {
    id: string;
    intent: string;
    riskClass: string;
    action: {
      type: string;
      value?: string;
      key?: string;
      url?: string;
      target?: {
        describedAs: string;
        strategies: {
          confidence: number;
          rationale: string;
          strategy: Record<string, unknown>;
        }[];
      };
    };
    checkpoint?: { describedAs: string; all: Record<string, unknown>[] };
    outcomes: { code: string; disposition: string; describedAs: string }[];
  }[];
  successCondition: { describedAs: string; all: Record<string, unknown>[] };
  outcomes: { code: string; disposition: string; describedAs: string }[];
  policy: {
    allowedOrigins: string[];
    allowedActions: string[];
    confirmAtOrAbove: string;
  };
  provenance: {
    discoveredBy: { provider: string; model: string };
    runId: string;
    createdAt: string;
    transcriptSha256: string;
    humanAssisted: boolean;
  };
};

export const evidence = {
  stats: () => get<Stats>("/api/stats"),
  runs: () => get<RunSummary[]>("/api/runs"),
  run: (id: string) =>
    get<{ summary: RunSummary; events: RunEvent[]; screenshots: string[] }>(
      `/api/runs/${id}`,
    ),
  screenshotUrl: (runId: string, name: string) =>
    `/api/runs/${runId}/screenshots/${name}`,
  capability: (ref: string) => get<CapabilityDoc>(`/api/capabilities/${ref}`),
  invoke: (ref: string, inputs: Record<string, unknown>, attended = false) =>
    post<Record<string, unknown>>(`/api/capabilities/${ref}/invoke`, {
      inputs,
      attended,
    }),
};

/* ------------------------------------------------------------ authoring ---- */

export type DiscoveryJob = {
  id: string;
  status: "running" | "succeeded" | "failed";
  goal: string;
  entryPoint: string;
  startedAt: string;
  finishedAt?: string;
  capabilityId?: string;
  version?: string;
  runId?: string;
  modelCalls?: number;
  steps?: number;
  error?: string;
};

export type DiscoveryInfo = {
  allowedOrigins: string[];
  configured: boolean;
  /** Names only — values never leave the server. */
  secretKeys: string[];
  jobs: DiscoveryJob[];
};

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (j as { error?: string }).error ?? `${path} -> ${r.status}`,
    );
  return j as T;
}

/** POST that surfaces the server's error message rather than a bare status. */
async function postX<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw new Error(
      (j as { error?: string }).error ?? `${path} -> ${r.status}`,
    );
  return j as T;
}

export const authoring = {
  info: () => get<DiscoveryInfo>("/api/discovery"),
  start: (body: Record<string, unknown>) =>
    postX<DiscoveryJob>("/api/discovery", body),
  job: (id: string) => get<DiscoveryJob>(`/api/discovery/${id}`),
  save: (ref: string, capability: unknown) =>
    put<{ ok: true; path: string; id: string; version: string }>(
      `/api/capabilities/${ref}`,
      capability,
    ),
  setStatus: (ref: string, status: "draft" | "approved" | "deprecated") =>
    postX<{ status: string }>(`/api/capabilities/${ref}/status`, { status }),
};
