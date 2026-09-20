import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, History } from "lucide-react";
import { api, type Intervention } from "../lib/api.ts";
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
  Badge,
} from "../../shared/ui.tsx";
import { PageHead, type RefreshPrefs } from "../App.tsx";

/** The escalation queue: every run that stopped and needs a person. */
export function Interventions({ prefs }: { prefs: RefreshPrefs }) {
  const { data, error, loading, refresh, lastUpdated } = usePoll<
    Intervention[]
  >(() => api.interventions(), 3000, prefs.auto);
  useNow();

  const open = (data ?? []).filter((i) => i.status !== "resolved");
  const closed = (data ?? []).filter((i) => i.status === "resolved");

  return (
    <>
      <PageHead
        title="Interventions"
        lede="Runs that stopped because they could not safely continue. Taking control attaches you to the same live session the automation was driving."
        lastUpdated={lastUpdated}
        onRefresh={refresh}
      />

      {error && <ErrorState error={error} onRetry={refresh} />}
      {loading && !data && <Skeleton rows={3} />}

      {data && open.length === 0 && (
        <EmptyState
          title="No open interventions"
          detail="Every run is proceeding on its own. Escalations appear here the moment one stops."
        />
      )}

      <div className="flex flex-col gap-3">
        {open.map((i) => (
          <Link key={i.id} to={`/session/${i.id}`} className="no-underline">
            <Card className="press hover:bg-blue-pale">
              <div className="flex flex-wrap items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{i.capabilityId}</span>
                    <StatusBadge status={i.status} />
                    {i.owner === "operator" && (
                      <Badge tone="live">held by {i.holder}</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-dim">{i.reason}</p>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-0.5 text-xs">
                    <span>
                      <span className="label-caps text-ink-faint">step </span>
                      <Mono className="text-blue">{i.stepId}</Mono>
                    </span>
                    <span className="text-ink-dim">{i.stepIntent}</span>
                    <span
                      title={formatAbsolute(i.raisedAt)}
                      className="text-ink-faint"
                    >
                      raised {formatRelative(i.raisedAt)}
                    </span>
                  </dl>
                </div>
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-faint" />
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {closed.length > 0 && (
        <Card
          className="mt-6"
          title={
            <span className="flex items-center gap-1.5">
              <History className="size-3.5" /> Resolved ({closed.length})
            </span>
          }
        >
          <ul className="flex flex-col">
            {closed.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-2 border-b border-rule-soft py-2 text-xs last:border-0"
              >
                <Mono className="text-ink-dim">{i.capabilityId}</Mono>
                <Mono className="text-blue">{i.stepId}</Mono>
                <span className="text-ink-faint">
                  {i.humanActions.length} operator action(s)
                </span>
                <span
                  className="ml-auto text-ink-faint"
                  title={formatAbsolute(i.raisedAt)}
                >
                  {formatRelative(i.raisedAt)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
