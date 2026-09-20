import { mkdirSync, appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactor, type Redactor } from "./redact.js";

/**
 * Structured run log.
 *
 * This is not diagnostics, it is a deliverable: /evidence/ is what shows a run
 * genuinely happened and makes a failure debuggable after the fact. So the
 * format is JSONL - one self-describing event per line, greppable, diffable,
 * and streamable to the operator console without a parser.
 *
 * Redaction is applied here, on the write path, rather than at call sites. A
 * call site that forgets to redact is the expected case, so forgetting has to be
 * safe. Everything written through this class is passed through Redactor.deep()
 * first, including screen text captured from the page.
 *
 * Writes are synchronous appends. Event volume is in the hundreds per run, and
 * synchronous writes guarantee that the last event before a crash is on disk -
 * which is exactly the event you want when debugging a crash.
 */

export type RunEventKind =
  | "run_started"
  | "run_finished"
  | "step_started"
  | "policy_verdict"
  | "action"
  | "observation"
  | "resolution"
  | "checkpoint"
  | "outcome_detected"
  | "recovery"
  | "model_request"
  | "model_response"
  | "escalation_raised"
  | "control_transferred"
  | "human_action"
  | "evidence_written"
  | "note";

export type RunEvent = {
  ts: string;
  runId: string;
  seq: number;
  kind: RunEventKind;
  stepId?: string;
  [k: string]: unknown;
};

export type RunMode = "discovery" | "replay";

export class RunLogger {
  readonly dir: string;
  readonly logPath: string;
  private seq = 0;
  private readonly red: Redactor;

  constructor(
    readonly runId: string,
    readonly mode: RunMode,
    opts: { baseDir?: string; redactor?: Redactor } = {},
  ) {
    this.red = opts.redactor ?? redactor;
    this.dir = join(opts.baseDir ?? "evidence", runId);
    this.logPath = join(this.dir, "run.jsonl");
    mkdirSync(join(this.dir, "screenshots"), { recursive: true });
    mkdirSync(join(this.dir, "ax"), { recursive: true });
  }

  /** Append one event. Returns it (redacted) so callers can echo it to a stream. */
  event(kind: RunEventKind, data: Record<string, unknown> = {}): RunEvent {
    const e: RunEvent = {
      ts: new Date().toISOString(),
      runId: this.runId,
      seq: ++this.seq,
      kind,
      ...(this.red.deep(data) as Record<string, unknown>),
    };
    appendFileSync(this.logPath, JSON.stringify(e) + "\n", "utf8");
    return e;
  }

  /**
   * Richer evidence on failure. Screenshots are binary and never contain text we
   * can scrub, so masking of sensitive regions has to happen at capture time in
   * the surface adapter - this only records where the file landed.
   */
  screenshot(buffer: Buffer, label: string): string {
    const name = `${String(this.seq).padStart(4, "0")}-${slug(label)}.jpeg`;
    const path = join(this.dir, "screenshots", name);
    writeFileSync(path, buffer);
    this.event("evidence_written", { artifact: "screenshot", path });
    return path;
  }

  /** The accessibility snapshot is text, so it is redacted like any other payload. */
  axSnapshot(snapshot: unknown, label: string): string {
    const name = `${String(this.seq).padStart(4, "0")}-${slug(label)}.json`;
    const path = join(this.dir, "ax", name);
    writeFileSync(
      path,
      JSON.stringify(this.red.deep(snapshot), null, 2),
      "utf8",
    );
    this.event("evidence_written", { artifact: "ax_snapshot", path });
    return path;
  }

  /** Summary written once at the end, so a reviewer does not have to read the JSONL. */
  finish(summary: Record<string, unknown>): void {
    this.event("run_finished", summary);
    writeFileSync(
      join(this.dir, "summary.json"),
      JSON.stringify(
        this.red.deep({
          runId: this.runId,
          mode: this.mode,
          finishedAt: new Date().toISOString(),
          events: this.seq,
          redactions: this.red.counters,
          ...summary,
        }),
        null,
        2,
      ),
      "utf8",
    );
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "evidence";

/** Run ids are sortable by time, which makes an evidence directory self-ordering. */
export const newRunId = (mode: RunMode): string =>
  `${mode}-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-${Math.random().toString(36).slice(2, 7)}`;
