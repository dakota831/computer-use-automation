import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { api, type Intervention } from "../lib/api.ts";

/** The escalation queue: every run that stopped and needs a person. */
export function Interventions() {
  const [items, setItems] = useState<Intervention[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      api
        .interventions()
        .then((i) => alive && (setItems(i), setError(null)))
        .catch((e) => alive && setError(String(e)));
    tick();
    const t = setInterval(tick, 3000);
    return () => ((alive = false), clearInterval(t), undefined);
  }, []);

  if (error) return <Empty title="API not reachable" detail={error} />;
  if (!items) return <Empty title="Loading…" />;
  if (!items.length)
    return (
      <Empty
        title="No interventions"
        detail="Every run is proceeding on its own."
      />
    );

  return (
    <ul className="flex flex-col gap-2">
      {items.map((i) => (
        <li key={i.id}>
          <a
            href={`#/session/${i.id}`}
            className="flex items-start gap-3 rounded-lg border border-edge bg-surface-raised p-4 hover:border-accent/50"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{i.capabilityId}</div>
              <div className="mt-0.5 text-sm text-ink-dim">{i.reason}</div>
              <div className="mt-2 font-mono text-xs text-ink-dim">
                step {i.stepId} &middot; {i.stepIntent}
              </div>
            </div>
            <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-dim" />
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge p-10 text-center">
      <div className="text-sm font-medium">{title}</div>
      {detail && (
        <div className="mt-1 font-mono text-xs text-ink-dim">{detail}</div>
      )}
    </div>
  );
}
