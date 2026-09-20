import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * Evidence browser.
 *
 * The run log is already a deliverable; this makes it navigable without SSH.
 * Being able to open a failed run, read the exact step that failed, see what was
 * expected against what was observed, and look at the screenshot is the
 * difference between evidence that exists and evidence anyone uses.
 *
 * Read-only by construction: nothing here writes, so browsing cannot corrupt the
 * record it is displaying.
 */

export type RunEvent = Record<string, unknown> & {
  ts: string;
  seq: number;
  kind: string;
  stepId?: string;
};

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

const EV = () => process.env.DEX_EVIDENCE_DIR ?? "evidence";

const safeRunId = (id: string) => /^[A-Za-z0-9._-]+$/.test(id);

function readEvents(dir: string): RunEvent[] {
  const p = join(dir, "run.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l) as RunEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is RunEvent => e !== null);
}

export function listRuns(): RunSummary[] {
  let dirs: string[] = [];
  try {
    dirs = readdirSync(EV()).filter((d) => {
      try {
        return statSync(join(EV(), d)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }

  return dirs
    .map((id) => summarise(id))
    .filter((r): r is RunSummary => r !== null)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export function summarise(id: string): RunSummary | null {
  if (!safeRunId(id)) return null;
  const dir = join(EV(), id);
  if (!existsSync(dir)) return null;

  const events = readEvents(dir);
  const started = events.find((e) => e.kind === "run_started");
  const finished = [...events].reverse().find((e) => e.kind === "run_finished");

  let summary: Record<string, unknown> = {};
  try {
    summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  } catch {
    /* a run that crashed before finishing has no summary; the events still tell the story */
  }

  const shots = existsSync(join(dir, "screenshots"))
    ? readdirSync(join(dir, "screenshots")).length
    : 0;
  const status = String(
    finished?.status ??
      summary.status ??
      (events.length ? "incomplete" : "unknown"),
  );

  const detail =
    status === "outcome"
      ? String(finished?.code ?? "")
      : status === "failed"
        ? String((finished?.failure as any)?.code ?? "")
        : status === "success" && finished?.outputs
          ? JSON.stringify(finished.outputs)
          : null;

  return {
    id,
    mode:
      id.startsWith("discovery") || String(summary.mode) === "discovery"
        ? "discovery"
        : id.includes("replay") || String(summary.mode) === "replay"
          ? "replay"
          : "unknown",
    status,
    startedAt: started?.ts ?? events[0]?.ts ?? null,
    finishedAt: finished?.ts ?? null,
    durationMs:
      typeof summary.durationMs === "number" ? summary.durationMs : null,
    capabilityId:
      (started?.capabilityId as string) ??
      (summary.capabilityId as string) ??
      null,
    events: events.length,
    screenshots: shots,
    detail,
  };
}

export function runDetail(
  id: string,
): { summary: RunSummary; events: RunEvent[]; screenshots: string[] } | null {
  const summary = summarise(id);
  if (!summary) return null;
  const dir = join(EV(), id);
  const screenshots = existsSync(join(dir, "screenshots"))
    ? readdirSync(join(dir, "screenshots")).sort()
    : [];
  return { summary, events: readEvents(dir), screenshots };
}

/**
 * Resolve a screenshot path safely. `basename` on the filename and a strict run
 * id pattern mean a crafted request cannot escape the evidence directory.
 */
export function screenshotPath(runId: string, name: string): string | null {
  if (!safeRunId(runId)) return null;
  const file = basename(name);
  if (!/^[A-Za-z0-9._-]+\.(jpeg|jpg|png)$/.test(file)) return null;
  const p = join(EV(), runId, "screenshots", file);
  return existsSync(p) ? p : null;
}

export function stats() {
  const runs = listRuns();
  const byStatus: Record<string, number> = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    runs: runs.length,
    byStatus,
    lastRunAt: runs[0]?.startedAt ?? null,
    discoveryRuns: runs.filter((r) => r.mode === "discovery").length,
  };
}
