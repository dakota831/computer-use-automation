import { Link } from "react-router-dom";
import {
  AlertTriangle,
  BookMarked,
  Activity,
  CheckCircle2,
} from "lucide-react";
import {
  evidence,
  api,
  type Stats,
  type RunSummary,
  type Intervention,
} from "../lib/api.ts";
import {
  usePoll,
  formatRelative,
  formatAbsolute,
  useNow,
} from "../../shared/hooks.ts";
import {
  Card,
  StatusBadge,
  EmptyState,
  Skeleton,
  ErrorState,
  Mono,
  TableWrap,
  Th,
  Td,
} from "../../shared/ui.tsx";
import { PageHead, type RefreshPrefs } from "../App.tsx";

/** Dashboard: what needs attention, and what the system just did. */
export function Overview({ prefs }: { prefs: RefreshPrefs }) {
  const s = usePoll<Stats>(() => evidence.stats(), 5000, prefs.auto);
  const r = usePoll<RunSummary[]>(() => evidence.runs(), 5000, prefs.auto);
  const i = usePoll<Intervention[]>(
    () => api.interventions(),
    4000,
    prefs.auto,
  );
  useNow();

  const open = (i.data ?? []).filter((x) => x.status !== "resolved");

  return (
    <>
      <PageHead
        title="Overview"
        lede="Capability inventory, open escalations and recent execution history."
        lastUpdated={s.lastUpdated}
        onRefresh={() => {
          s.refresh();
          r.refresh();
          i.refresh();
        }}
      />

      {s.error && <ErrorState error={s.error} onRetry={s.refresh} />}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          icon={<BookMarked className="size-4" />}
          label="Capabilities"
          value={s.data?.capabilities}
          sub={`${s.data?.approved ?? 0} approved · ${s.data?.drafts ?? 0} draft`}
          to="/capabilities"
        />
        <Stat
          icon={<AlertTriangle className="size-4" />}
          label="Open interventions"
          value={open.length}
          sub={open.length ? "needs a human" : "none waiting"}
          to="/interventions"
          tone={open.length ? "danger" : undefined}
        />
        <Stat
          icon={<Activity className="size-4" />}
          label="Runs recorded"
          value={s.data?.runs}
          sub={`${s.data?.discoveryRuns ?? 0} discovery`}
          to="/runs"
        />
        <Stat
          icon={<CheckCircle2 className="size-4" />}
          label="Last activity"
          value={s.data?.lastRunAt ? formatRelative(s.data.lastRunAt) : "—"}
          sub={
            s.data?.lastRunAt ? formatAbsolute(s.data.lastRunAt) : "no runs yet"
          }
          to="/runs"
        />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.3fr]">
        <Card
          title="Needs attention"
          aside={
            <Link
              to="/interventions"
              className="label-caps text-blue hover:underline"
            >
              All
            </Link>
          }
        >
          {i.loading && !i.data ? (
            <Skeleton rows={2} />
          ) : open.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              detail="Every run is proceeding on its own."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {open.slice(0, 5).map((x) => (
                <li key={x.id}>
                  <Link
                    to={`/session/${x.id}`}
                    className="rule press flex items-start gap-3 bg-paper-sunk p-2.5 no-underline shadow-hard-sm hover:bg-blue-pale"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {x.capabilityId}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-dim">{x.reason}</p>
                      <p className="mt-1">
                        <Mono className="text-ink-faint">{x.stepId}</Mono>
                      </p>
                    </div>
                    <StatusBadge status={x.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Recent runs"
          aside={
            <Link to="/runs" className="label-caps text-blue hover:underline">
              All
            </Link>
          }
        >
          {r.loading && !r.data ? (
            <Skeleton rows={4} />
          ) : !r.data?.length ? (
            <EmptyState
              title="No runs yet"
              detail="Run a discovery pass or replay a capability."
            />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <Th>Run</Th>
                  <Th>Mode</Th>
                  <Th>Status</Th>
                  <Th>Detail</Th>
                  <Th>When</Th>
                </tr>
              </thead>
              <tbody>
                {r.data.slice(0, 8).map((run) => (
                  <tr key={run.id} className="hover:bg-paper-sunk">
                    <Td>
                      <Link
                        to={`/runs/${run.id}`}
                        className="font-mono text-xs text-blue hover:underline"
                      >
                        {run.id.slice(0, 26)}
                      </Link>
                    </Td>
                    <Td>
                      <span className="label-caps text-ink-faint">
                        {run.mode}
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={run.status} />
                    </Td>
                    <Td>
                      <Mono className="text-ink-dim">
                        {(run.detail ?? "").slice(0, 34) || "—"}
                      </Mono>
                    </Td>
                    <Td>
                      <span
                        title={formatAbsolute(run.startedAt)}
                        className="text-xs text-ink-faint"
                      >
                        {formatRelative(run.startedAt)}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  to,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: string;
  to: string;
  tone?: "danger";
}) {
  return (
    <Link
      to={to}
      className="press rule flex flex-col bg-paper-raised p-3 no-underline shadow-hard hover:bg-blue-pale"
    >
      <span className="label-caps flex items-center gap-1.5 text-ink-faint">
        {icon}
        {label}
      </span>
      <span
        className={`mt-1.5 text-2xl font-bold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}
      >
        {value ?? "—"}
      </span>
      <span className="mt-0.5 text-xs text-ink-dim">{sub}</span>
    </Link>
  );
}
