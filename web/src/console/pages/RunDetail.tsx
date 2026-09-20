import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { useParams } from "react-router-dom";
import { evidence, type RunEvent, type RunSummary } from "../lib/api.ts";
import { formatAbsolute } from "../../shared/hooks.ts";
import {
  Card,
  StatusBadge,
  Badge,
  Field,
  Mono,
  Skeleton,
  ErrorState,
  EmptyState,
} from "../../shared/ui.tsx";
import { CopyButton } from "../../shared/Chrome.tsx";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { Button, Kbd } from "../../shared/ui.tsx";
import { Crumbs, PageHead } from "../App.tsx";

/**
 * A single run, as a timeline.
 *
 * The event kinds are colour-coded because scanning for the one policy denial in
 * three hundred events is the actual task. Anything unusual - a denial, a
 * detected outcome, an escalation, a low-confidence locator resolution - is
 * meant to catch the eye without being searched for.
 */

const KIND_TONE: Record<
  string,
  "neutral" | "ok" | "warn" | "danger" | "info" | "live"
> = {
  run_started: "info",
  run_finished: "ok",
  action: "neutral",
  resolution: "neutral",
  checkpoint: "ok",
  policy_verdict: "info",
  outcome_detected: "warn",
  recovery: "warn",
  escalation_raised: "danger",
  control_transferred: "live",
  human_action: "live",
  model_response: "info",
  evidence_written: "neutral",
  note: "neutral",
};

/**
 * What counts as worth looking at.
 *
 * Scanning three hundred events for the one policy denial is the actual task on
 * this page, so the interesting ones are addressable directly. "Interesting" is
 * anything that departed from the straight path: a refusal, a detected outcome,
 * a recovery, an escalation, a failed checkpoint, a locator that needed a
 * fallback strategy, or a run that did not end in success.
 */
export function isAnomaly(e: RunEvent): boolean {
  switch (e.kind) {
    case "policy_verdict":
      return e.decision !== "allow";
    case "outcome_detected":
    case "recovery":
    case "escalation_raised":
    case "control_transferred":
    case "human_action":
      return true;
    case "checkpoint":
      return e.ok === false;
    case "resolution":
      return (
        e.ok === false ||
        (typeof e.strategyIndex === "number" && e.strategyIndex > 0)
      );
    case "run_finished":
      return e.status !== "success";
    case "note":
      return Boolean(e.error);
    default:
      return false;
  }
}

export function RunDetail() {
  const { id = "" } = useParams();
  const [data, setData] = useState<{
    summary: RunSummary;
    events: RunEvent[];
    screenshots: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [cursor, setCursor] = useState(-1);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    evidence
      .run(id)
      .then(setData)
      .catch((e) => setError(String(e)));
  }, [id]);

  const kinds = useMemo(
    () => [...new Set((data?.events ?? []).map((e) => e.kind))].sort(),
    [data],
  );
  const events = useMemo(
    () =>
      (data?.events ?? []).filter((e) => filter === "all" || e.kind === filter),
    [data, filter],
  );

  const anomalies = useMemo(
    () => events.map((e, i) => (isAnomaly(e) ? i : -1)).filter((i) => i >= 0),
    [events],
  );

  const jumpToNext = useCallback(() => {
    if (!anomalies.length) return;
    const next = anomalies.find((i) => i > cursor) ?? anomalies[0]!;
    setCursor(next);
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-row="${next}"]`,
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.focus({ preventScroll: true });
  }, [anomalies, cursor]);

  // `n` steps through anomalies without reaching for the mouse.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      )
        return;
      if (ev.key === "n") {
        ev.preventDefault();
        jumpToNext();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpToNext]);

  if (error) return <ErrorState error={error} />;
  if (!data) return <Skeleton rows={8} />;

  const { summary } = data;

  return (
    <>
      <Crumbs trail={[{ label: "Runs", to: "/runs" }, { label: summary.id }]} />
      <PageHead
        title={summary.mode === "discovery" ? "Discovery run" : "Replay run"}
        right={<StatusBadge status={summary.status} />}
      />

      <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Summary">
            <dl>
              <Field label="Run id" mono>
                {summary.id}{" "}
                <CopyButton
                  value={summary.id}
                  label="run id"
                  className="ml-1 align-middle"
                />
              </Field>
              <Field label="Capability" mono>
                {summary.capabilityId ?? "—"}
              </Field>
              <Field label="Started" mono>
                {formatAbsolute(summary.startedAt)}
              </Field>
              <Field label="Duration" mono>
                {summary.durationMs != null
                  ? `${(summary.durationMs / 1000).toFixed(2)}s`
                  : "—"}
              </Field>
              <Field label="Events" mono>
                {summary.events}
              </Field>
              <Field label="Detail" mono>
                {summary.detail ?? "—"}
              </Field>
            </dl>
          </Card>

          {data.screenshots.length > 0 && (
            <Card title={`Screenshots (${data.screenshots.length})`}>
              <div className="flex min-w-0 flex-col gap-3">
                {data.screenshots.map((s) => (
                  <figure key={s}>
                    <img
                      src={evidence.screenshotUrl(summary.id, s)}
                      alt={s}
                      loading="lazy"
                      className="rule w-full shadow-hard-sm"
                    />
                    <figcaption className="mt-1 font-mono text-[0.625rem] break-all text-ink-faint">
                      {s}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </Card>
          )}
        </div>

        <Card
          title={`Timeline (${events.length})`}
          aside={
            <>
              <Button
                size="sm"
                onClick={jumpToNext}
                disabled={!anomalies.length}
                title="Jump to the next notable event (n)"
              >
                <AlertTriangle className="size-3.5" />
                {anomalies.length
                  ? `${anomalies.length} notable`
                  : "none notable"}
                <ChevronDown className="size-3.5" />
              </Button>
              <Kbd>n</Kbd>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                aria-label="Filter events by kind"
                className="rule bg-paper-raised px-1.5 py-0.5 font-mono text-xs"
              >
                <option value="all">all kinds</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </>
          }
        >
          {events.length === 0 ? (
            <EmptyState
              title="No events"
              detail="This run produced no log entries."
            />
          ) : (
            <ol className="flex flex-col" ref={listRef}>
              {events.map((e, i) => (
                <EventRow
                  key={e.seq}
                  e={e}
                  index={i}
                  highlighted={i === cursor}
                />
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function EventRow({
  e,
  index,
  highlighted,
}: {
  e: RunEvent;
  index: number;
  highlighted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { ts, seq, kind, stepId, ...rest } = e;
  const summary = summarise(kind, rest);

  return (
    <li
      data-row={index}
      tabIndex={-1}
      className={clsx(
        "border-b border-rule-soft py-1.5 outline-none last:border-0",
        highlighted && "bg-blue-pale ring-2 ring-blue",
        isAnomaly(e) && !highlighted && "bg-warn-pale/40",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="w-9 shrink-0 pt-0.5 text-right font-mono text-[0.625rem] text-ink-faint">
          {seq}
        </span>
        <Badge tone={KIND_TONE[kind] ?? "neutral"} className="shrink-0">
          {kind.replace(/_/g, " ")}
        </Badge>
        {stepId && <Mono className="shrink-0 text-blue">{stepId}</Mono>}
        <span className="min-w-0 flex-1 truncate text-xs text-ink-dim">
          {summary}
        </span>
        <span className="shrink-0 font-mono text-[0.625rem] text-ink-faint">
          {new Date(ts).toISOString().slice(11, 19)}
        </span>
      </button>
      {open && (
        <pre className="rule mt-1.5 ml-11 max-h-72 min-w-0 max-w-full overflow-auto bg-paper-sunk p-2 font-mono text-[0.625rem] leading-relaxed">
          {JSON.stringify(rest, null, 2)}
        </pre>
      )}
    </li>
  );
}

/** One readable line per event kind, so the timeline scans without expanding rows. */
function summarise(kind: string, r: Record<string, unknown>): string {
  const s = (k: string) => (r[k] === undefined ? "" : String(r[k]));
  switch (kind) {
    case "action":
      return [
        s("type"),
        s("label") || s("key") || s("url") || s("into"),
        r.value !== undefined ? `= ${s("value")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "resolution":
      return r.ok
        ? `${s("role")} "${s("label")}" via strategy ${s("strategyIndex")} (${s("strategyKind")}, conf ${s("confidence")})`
        : `unresolved: ${s("reason")}`;
    case "checkpoint":
      return `${r.ok ? "met" : "NOT met"} · ${s("describedAs")}`;
    case "policy_verdict":
      return `${s("decision")}${r.code ? ` · ${s("code")}` : ""}${r.reason ? ` · ${s("reason")}` : ""}`;
    case "outcome_detected":
      return `${s("code")} → ${s("disposition")}`;
    case "model_response":
      return `${s("latencyMs")}ms · ${Array.isArray(r.toolCalls) ? (r.toolCalls as string[]).join(",") : ""}`;
    case "escalation_raised":
      return s("reason");
    case "control_transferred":
      return `${s("from")} → ${s("to")} by ${s("actor")}`;
    case "human_action":
      return `${s("kind")} ${JSON.stringify(r.detail ?? {})}`;
    case "run_finished":
      return `${s("status")}${r.code ? ` · ${s("code")}` : ""}`;
    case "run_started":
      return `${s("capabilityId") || s("goal")}`;
    default:
      return Object.keys(r)
        .slice(0, 3)
        .map((k) => `${k}=${String(r[k]).slice(0, 28)}`)
        .join(" ");
  }
}
