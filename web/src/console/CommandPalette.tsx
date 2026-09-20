import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CornerDownLeft, Search } from "lucide-react";
import clsx from "clsx";
import {
  api,
  evidence,
  type CapabilitySummary,
  type Intervention,
  type RunSummary,
} from "./lib/api.ts";
import { Kbd } from "../shared/ui.tsx";

/**
 * Command palette.
 *
 * Jumping straight to a capability, an intervention or a run by typing part of
 * its name is the single biggest speed difference between a demo and a tool
 * someone actually works in. Everything addressable is reachable from here.
 */

type Item = {
  id: string;
  label: string;
  hint: string;
  group: string;
  to: string;
};

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [items, setItems] = useState<Item[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    const base: Item[] = [
      {
        id: "nav-o",
        label: "Overview",
        hint: "g o",
        group: "Navigate",
        to: "/",
      },
      {
        id: "nav-i",
        label: "Interventions",
        hint: "g i",
        group: "Navigate",
        to: "/interventions",
      },
      {
        id: "nav-c",
        label: "Capabilities",
        hint: "g c",
        group: "Navigate",
        to: "/capabilities",
      },
      {
        id: "nav-r",
        label: "Runs",
        hint: "g r",
        group: "Navigate",
        to: "/runs",
      },
    ];
    setItems(base);
    Promise.allSettled([
      api.capabilities(),
      api.interventions(),
      evidence.runs(),
    ]).then(([caps, ivs, runs]) => {
      const extra: Item[] = [];
      if (caps.status === "fulfilled")
        extra.push(
          ...(caps.value as CapabilitySummary[]).map((c) => ({
            id: `cap-${c.id}`,
            label: c.title,
            hint: `${c.id}@${c.version} · ${c.status}`,
            group: "Capabilities",
            to: `/capabilities/${c.id}@${c.version}`,
          })),
        );
      if (ivs.status === "fulfilled")
        extra.push(
          ...(ivs.value as Intervention[]).map((i) => ({
            id: `iv-${i.id}`,
            label: `${i.capabilityId} · ${i.stepId}`,
            hint: `${i.status} · ${i.id}`,
            group: "Interventions",
            to: `/session/${i.id}`,
          })),
        );
      if (runs.status === "fulfilled")
        extra.push(
          ...(runs.value as RunSummary[]).slice(0, 40).map((r) => ({
            id: `run-${r.id}`,
            label: r.id,
            hint: `${r.mode} · ${r.status}`,
            group: "Runs",
            to: `/runs/${r.id}`,
          })),
        );
      setItems([...base, ...extra]);
    });
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 12);
    return items
      .filter((i) =>
        `${i.label} ${i.hint} ${i.group}`.toLowerCase().includes(needle),
      )
      .slice(0, 20);
  }, [q, items]);

  useEffect(() => setSel(0), [q]);

  const go = (i: Item | undefined) => {
    if (!i) return;
    nav(i.to);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-40 flex items-start justify-center bg-navy-deep/60 p-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="rule w-full max-w-xl bg-paper-raised shadow-hard-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="rule-b flex items-center gap-2 px-3 py-2">
          <Search className="size-4 shrink-0 text-ink-faint" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, filtered.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              }
              if (e.key === "Enter") {
                e.preventDefault();
                go(filtered[sel]);
              }
              if (e.key === "Escape") onClose();
            }}
            placeholder="Jump to a capability, intervention or run…"
            aria-label="Search"
            className="w-full bg-transparent py-1 text-sm outline-none placeholder:text-ink-faint"
          />
          <Kbd>esc</Kbd>
        </div>

        <ul role="listbox" className="max-h-[50vh] overflow-y-auto">
          {filtered.length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-ink-faint">
              No matches
            </li>
          )}
          {filtered.map((i, n) => (
            <li key={i.id}>
              <button
                role="option"
                aria-selected={n === sel}
                onMouseEnter={() => setSel(n)}
                onClick={() => go(i)}
                className={clsx(
                  "flex w-full items-center gap-3 border-b border-rule-soft px-3 py-2 text-left",
                  n === sel ? "bg-blue-pale" : "hover:bg-paper-sunk",
                )}
              >
                <span className="label-caps w-24 shrink-0 text-ink-faint">
                  {i.group}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {i.label}
                </span>
                <span className="hidden truncate font-mono text-[0.6875rem] text-ink-faint sm:block">
                  {i.hint}
                </span>
                {n === sel && (
                  <CornerDownLeft className="size-3.5 shrink-0 text-blue" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
