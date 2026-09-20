import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Sparkles, GitCompare } from "lucide-react";
import { api, type CapabilitySummary } from "../lib/api.ts";
import { usePoll } from "../../shared/hooks.ts";
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
  ErrorState,
  Mono,
  Badge,
  Button,
} from "../../shared/ui.tsx";
import { PageHead } from "../App.tsx";

/** The catalog: what an agent can call, and in what state. */
export function Capabilities() {
  const { data, error, loading, refresh, lastUpdated } = usePoll<
    CapabilitySummary[]
  >(() => api.capabilities(), 15000);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | "approved" | "draft">("all");

  const items = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data ?? [])
      .filter((c) => (status === "all" ? true : c.status === status))
      .filter(
        (c) =>
          !needle ||
          `${c.id} ${c.title} ${c.description} ${c.vendorApp}`
            .toLowerCase()
            .includes(needle),
      );
  }, [data, q, status]);

  return (
    <>
      <PageHead
        title="Capabilities"
        lede="Recorded flows an agent can invoke by name with typed arguments. Only approved capabilities may run unattended."
        lastUpdated={lastUpdated}
        onRefresh={refresh}
        right={
          <div className="flex gap-2">
            <Link to="/capabilities/compare" className="no-underline">
              <Button size="sm">
                <GitCompare className="size-4" /> Compare
              </Button>
            </Link>
            <Link to="/capabilities/new" className="no-underline">
              <Button size="sm" variant="primary">
                <Sparkles className="size-4" /> Teach new
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="rule flex min-w-56 flex-1 items-center gap-2 bg-paper-raised px-2 py-1.5 shadow-hard-sm sm:max-w-sm">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter capabilities…"
            aria-label="Filter capabilities"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
        <div role="group" aria-label="Filter by status" className="flex">
          {(["all", "approved", "draft"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              className={`label-caps border-2 px-2.5 py-1.5 ${status === s ? "border-rule bg-navy text-white" : "border-rule bg-paper-raised"} -ml-0.5 first:ml-0`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorState error={error} onRetry={refresh} />}
      {loading && !data && <Skeleton rows={3} />}
      {data && items.length === 0 && (
        <EmptyState
          title="No capabilities match"
          detail="Clear the filter, or record one with a discovery run."
        />
      )}

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        {items.map((c) => (
          <Link
            key={`${c.id}@${c.version}`}
            to={`/capabilities/${c.id}@${c.version}`}
            className="block min-w-0 no-underline"
          >
            <Card
              className="press h-full hover:bg-blue-pale"
              title={<span className="block min-w-0 truncate">{c.title}</span>}
              aside={<StatusBadge status={c.status} />}
            >
              <p className="text-sm text-ink-dim">{c.description}</p>
              <dl className="mt-3 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                <dt className="label-caps text-ink-faint">id</dt>
                <dd className="min-w-0 break-all">
                  <Mono>
                    {c.id}@{c.version}
                  </Mono>
                </dd>
                <dt className="label-caps text-ink-faint">app</dt>
                <dd className="min-w-0 break-all">
                  <Mono>{c.vendorApp}</Mono> · tenant <Mono>{c.tenant}</Mono>
                </dd>
                <dt className="label-caps text-ink-faint">in</dt>
                <dd className="min-w-0 break-all">
                  <Mono>
                    {c.inputs.map((i) => `${i.name}:${i.type}`).join(", ") ||
                      "—"}
                  </Mono>
                </dd>
                <dt className="label-caps text-ink-faint">out</dt>
                <dd className="min-w-0 break-all">
                  <Mono>
                    {c.outputs.map((o) => `${o.name}:${o.type}`).join(", ") ||
                      "—"}
                  </Mono>
                </dd>
              </dl>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>{c.steps} steps</Badge>
                {c.outcomes.length ? (
                  <Badge tone="info">
                    {c.outcomes.length} declared outcomes
                  </Badge>
                ) : (
                  <Badge tone="warn">no outcomes declared</Badge>
                )}
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
