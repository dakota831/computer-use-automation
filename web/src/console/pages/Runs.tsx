import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { evidence, type RunSummary } from "../lib/api.ts";
import {
  usePoll,
  formatRelative,
  formatAbsolute,
  useNow,
} from "../../shared/hooks.ts";
import {
  StatusBadge,
  EmptyState,
  Skeleton,
  ErrorState,
  Mono,
  TableWrap,
  Th,
  Td,
  Card,
} from "../../shared/ui.tsx";
import { PageHead, type RefreshPrefs } from "../App.tsx";

/** Evidence browser. Every run the system has recorded, newest first. */
export function Runs({ prefs }: { prefs: RefreshPrefs }) {
  const { data, error, loading, refresh, lastUpdated } = usePoll<RunSummary[]>(
    () => evidence.runs(),
    6000,
    prefs.auto,
  );
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<"all" | "discovery" | "replay">("all");
  useNow();

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((r) => (mode === "all" ? true : r.mode === mode))
      .filter(
        (r) =>
          !needle ||
          `${r.id} ${r.status} ${r.capabilityId ?? ""} ${r.detail ?? ""}`
            .toLowerCase()
            .includes(needle),
      );
  }, [data, q, mode]);

  return (
    <>
      <PageHead
        title="Runs"
        lede="Structured evidence for every discovery and replay: actions, policy verdicts, locator resolutions, checkpoints and outcomes."
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="rule flex min-w-56 flex-1 items-center gap-2 bg-paper-raised px-2 py-1.5 shadow-hard-sm sm:max-w-sm">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter runs…"
            aria-label="Filter runs"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
        <div role="group" aria-label="Filter by mode" className="flex">
          {(["all", "discovery", "replay"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`label-caps -ml-0.5 border-2 border-rule px-2.5 py-1.5 first:ml-0 ${mode === m ? "bg-navy text-white" : "bg-paper-raised"}`}
            >
              {m}
            </button>
          ))}
        </div>
        <span className="label-caps ml-auto text-ink-faint">
          {rows.length} of {data?.length ?? 0}
        </span>
      </div>

      {error && <ErrorState error={error} onRetry={refresh} />}
      {loading && !data && <Skeleton rows={6} />}
      {data && rows.length === 0 && (
        <EmptyState
          title="No runs match"
          detail="Clear the filter, or run a capability to produce evidence."
        />
      )}

      {rows.length > 0 && (
        <Card>
          <TableWrap>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Mode</Th>
                <Th>Status</Th>
                <Th>Detail</Th>
                <Th className="text-right">Events</Th>
                <Th>Started</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-paper-sunk">
                  <Td>
                    <Link
                      to={`/runs/${r.id}`}
                      className="font-mono text-xs text-blue hover:underline"
                    >
                      {r.id}
                    </Link>
                  </Td>
                  <Td>
                    <span className="label-caps text-ink-faint">{r.mode}</span>
                  </Td>
                  <Td>
                    <StatusBadge status={r.status} />
                  </Td>
                  <Td>
                    <Mono className="text-ink-dim">
                      {(r.detail ?? "—").slice(0, 46)}
                    </Mono>
                  </Td>
                  <Td className="text-right tabular-nums">
                    <Mono>{r.events}</Mono>
                  </Td>
                  <Td>
                    <span
                      title={formatAbsolute(r.startedAt)}
                      className="text-xs text-ink-faint"
                    >
                      {formatRelative(r.startedAt)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </>
  );
}
