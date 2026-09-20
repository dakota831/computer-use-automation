/**
 * Typed client for the operator/catalog API.
 *
 * These types are hand-mirrored from the server contract for now. Once the
 * server routes exist they should be generated from the same Zod schemas the
 * backend validates with, so the console cannot drift from the API.
 */

export type ControlOwner = "automation" | "operator" | "none";

export type Intervention = {
  id: string;
  runId: string;
  capabilityId: string;
  goal: string;
  stepId: string;
  stepIntent: string;
  /** Why automation stopped. The operator needs this before touching anything. */
  reason: string;
  raisedAt: string;
  owner: ControlOwner;
  screenshotUrl?: string;
};

export type CapabilitySummary = {
  id: string;
  version: string;
  title: string;
  description: string;
  status: "draft" | "approved" | "deprecated";
  tenant: string;
  vendorApp: string;
  inputs: {
    name: string;
    type: string;
    required: boolean;
    description: string;
  }[];
  outputs: { name: string; type: string; description: string }[];
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

export const api = {
  interventions: () => get<Intervention[]>("/api/interventions"),
  takeControl: (id: string) =>
    post<{ owner: ControlOwner }>(`/api/interventions/${id}/take`),
  releaseControl: (id: string, note: string) =>
    post<{ owner: ControlOwner }>(`/api/interventions/${id}/release`, { note }),
  capabilities: () => get<CapabilitySummary[]>("/api/capabilities"),
  invoke: (id: string, inputs: Record<string, unknown>) =>
    post<unknown>(`/api/capabilities/${id}/invoke`, { inputs }),
};
