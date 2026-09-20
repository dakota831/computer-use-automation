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
