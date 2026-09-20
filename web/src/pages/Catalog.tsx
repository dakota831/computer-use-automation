import { useEffect, useState } from "react";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { api, type CapabilitySummary } from "../lib/api.ts";
import { Empty } from "./Interventions.tsx";

/**
 * Capabilities as a browsable catalog: what a calling agent would discover.
 * Status is shown prominently because it is the gate on unattended replay -
 * a draft capability may only be run with a human watching.
 */
export function Catalog() {
  const [items, setItems] = useState<CapabilitySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .capabilities()
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <Empty title="API not reachable" detail={error} />;
  if (!items) return <Empty title="Loading…" />;
  if (!items.length)
    return (
      <Empty
        title="No capabilities recorded yet"
        detail="Run a discovery pass to create one."
      />
    );

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {items.map((c) => (
        <div
          key={`${c.id}@${c.version}`}
          className="rounded-lg border border-edge bg-surface-raised p-4"
        >
          <div className="flex items-center gap-2">
            {c.status === "approved" ? (
              <CheckCircle2 className="size-4 text-ok" />
            ) : (
              <CircleDashed className="size-4 text-ink-dim" />
            )}
            <span className="font-medium">{c.title}</span>
            <span className="ml-auto font-mono text-xs text-ink-dim">
              v{c.version}
            </span>
          </div>
          <p className="mt-2 text-sm text-ink-dim">{c.description}</p>
          <div className="mt-3 font-mono text-xs text-ink-dim">
            <div>
              in &nbsp;
              {c.inputs.map((i) => `${i.name}:${i.type}`).join(", ") || "—"}
            </div>
            <div>
              out{" "}
              {c.outputs.map((o) => `${o.name}:${o.type}`).join(", ") || "—"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
