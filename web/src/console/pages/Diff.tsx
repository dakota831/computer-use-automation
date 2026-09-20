import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import clsx from "clsx";
import { api, evidence, type CapabilitySummary } from "../lib/api.ts";
import {
  Card,
  Skeleton,
  ErrorState,
  Badge,
  EmptyState,
} from "../../shared/ui.tsx";
import { Crumbs, PageHead } from "../App.tsx";

/**
 * Compare two capabilities.
 *
 * The case this exists for: an agent-discovered draft next to a reviewed,
 * approved capability for the same flow. Seeing them side by side makes the
 * review concrete — what the model got right, and what a human still has to
 * add (almost always the outcome table, which one happy-path run cannot know).
 *
 * The diff is computed over pretty-printed JSON with a plain LCS. These
 * documents are a few hundred lines, so O(n·m) is imperceptible and avoids a
 * dependency for something this contained.
 */

type Row = { kind: "same" | "add" | "del"; a?: string; b?: string };

function diffLines(a: string[], b: string[]): Row[] {
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the longest common subsequence of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const out: Row[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", a: a[i], b: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "del", a: a[i] });
      i++;
    } else {
      out.push({ kind: "add", b: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", a: a[i++] });
  while (j < m) out.push({ kind: "add", b: b[j++] });
  return out;
}

/** Drop fields that differ on every run and say nothing about the flow. */
function normalise(cap: Record<string, unknown>): string {
  const { provenance, ...rest } = cap as Record<string, unknown> & {
    provenance?: Record<string, unknown>;
  };
  return JSON.stringify(
    {
      ...rest,
      provenance: provenance
        ? {
            discoveredBy: provenance.discoveredBy,
            humanAssisted: provenance.humanAssisted,
          }
        : undefined,
    },
    null,
    2,
  );
}

export function Diff() {
  const [params, setParams] = useSearchParams();
  const [caps, setCaps] = useState<CapabilitySummary[] | null>(null);
  const [docs, setDocs] = useState<{ a?: string; b?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [hideSame, setHideSame] = useState(true);

  const a = params.get("a") ?? "";
  const b = params.get("b") ?? "";

  useEffect(() => {
    api
      .capabilities()
      .then(setCaps)
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    setDocs({});
    const load = async (ref: string) =>
      ref
        ? normalise(
            (await evidence.capability(ref)) as unknown as Record<
              string,
              unknown
            >,
          )
        : undefined;
    Promise.all([load(a), load(b)])
      .then(([x, y]) => setDocs({ a: x, b: y }))
      .catch((e) => setError(String(e)));
  }, [a, b]);

  const rows = useMemo(() => {
    if (!docs.a || !docs.b) return null;
    return diffLines(docs.a.split("\n"), docs.b.split("\n"));
  }, [docs]);

  const stats = useMemo(() => {
    if (!rows) return null;
    return {
      added: rows.filter((r) => r.kind === "add").length,
      removed: rows.filter((r) => r.kind === "del").length,
    };
  }, [rows]);

  const shown = useMemo(() => {
    if (!rows) return [];
    if (!hideSame) return rows;
    // Keep a little context around each change so the diff is readable.
    const keep = new Set<number>();
    rows.forEach((r, i) => {
      if (r.kind === "same") return;
      for (
        let k = Math.max(0, i - 2);
        k <= Math.min(rows.length - 1, i + 2);
        k++
      )
        keep.add(k);
    });
    return rows.filter((_, i) => keep.has(i));
  }, [rows, hideSame]);

  const pick =
    (which: "a" | "b") => (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = new URLSearchParams(params);
      next.set(which, e.target.value);
      setParams(next, { replace: true });
    };

  const options = caps ?? [];

  return (
    <>
      <Crumbs
        trail={[
          { label: "Capabilities", to: "/capabilities" },
          { label: "Compare" },
        ]}
      />
      <PageHead
        title="Compare capabilities"
        lede="Put an agent-discovered draft beside a reviewed capability to see exactly what review added."
      />

      {error && <ErrorState error={error} />}
      {!caps && <Skeleton rows={4} />}

      {caps && (
        <Card
          title="Select two"
          aside={
            stats && (
              <span className="flex gap-2">
                <Badge tone="ok">+{stats.added}</Badge>
                <Badge tone="danger">&minus;{stats.removed}</Badge>
              </span>
            )
          }
        >
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            {(["a", "b"] as const).map((side) => (
              <label key={side} className="flex flex-col gap-1">
                <span className="label-caps text-ink-faint">
                  {side === "a" ? "Base (left)" : "Compare (right)"}
                </span>
                <select
                  value={side === "a" ? a : b}
                  onChange={pick(side)}
                  className="rule w-full min-w-0 max-w-full bg-paper-sunk px-2 py-1.5 font-mono text-xs"
                >
                  <option value="">— choose —</option>
                  {options.map((c) => (
                    <option
                      key={`${c.id}@${c.version}`}
                      value={`${c.id}@${c.version}`}
                    >
                      {c.id}@{c.version} ({c.status})
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={hideSame}
              onChange={(e) => setHideSame(e.target.checked)}
            />
            Show only changes, with context
          </label>
        </Card>
      )}

      {!a || !b ? (
        <div className="mt-4">
          <EmptyState
            title="Pick two capabilities"
            detail="Comparing a discovered draft with an approved one shows what human review contributed."
          />
        </div>
      ) : !rows ? (
        <div className="mt-4">
          <Skeleton rows={8} />
        </div>
      ) : (
        <Card className="mt-4" title={`${a}  →  ${b}`}>
          <div className="min-w-0 max-w-full overflow-x-auto">
            <pre className="w-max min-w-full font-mono text-[0.6875rem] leading-relaxed">
              {shown.map((r, i) => (
                <div
                  key={i}
                  className={clsx(
                    "px-2",
                    r.kind === "add" && "bg-ok-pale text-ok",
                    r.kind === "del" && "bg-danger-pale text-danger",
                    r.kind === "same" && "text-ink-faint",
                  )}
                >
                  <span className="mr-2 inline-block w-3 select-none opacity-70">
                    {r.kind === "add" ? "+" : r.kind === "del" ? "-" : " "}
                  </span>
                  {r.a ?? r.b}
                </div>
              ))}
            </pre>
          </div>
          {stats?.added === 0 && stats?.removed === 0 && (
            <p className="mt-2 text-sm text-ink-dim">
              These two are identical once provenance is set aside.
            </p>
          )}
        </Card>
      )}
    </>
  );
}
