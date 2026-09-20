import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Shared behaviour for the console.
 *
 * Everything here exists because an operations tool is used for hours, not
 * seconds: state that survives a reload, polling you can stop when you need to
 * read something, and keyboard access that does not require a mouse.
 */

/** State mirrored to localStorage. Degrades silently in private browsing. */
export function useLocalStorage<T>(
  key: string,
  initial: T,
): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* quota or private mode; the UI still works, it just forgets */
      }
    },
    [key],
  );
  return [value, set];
}

/**
 * Poll an async source, with a pause control.
 *
 * The pause matters: a list that refreshes under you while you are reading a
 * failure message is actively hostile, and an operator investigating an incident
 * needs the screen to hold still.
 */
export function usePoll<T>(
  fetcher: () => Promise<T>,
  intervalMs = 4000,
  enabled = true,
): {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
  lastUpdated: Date | null;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const fn = useRef(fetcher);
  fn.current = fetcher;

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let alive = true;
    const run = () =>
      fn
        .current()
        .then((d) => {
          if (!alive) return;
          setData(d);
          setError(null);
          setLastUpdated(new Date());
        })
        .catch((e) => alive && setError(String(e)))
        .finally(() => alive && setLoading(false));
    run();
    if (!enabled) return () => void (alive = false);
    const t = setInterval(run, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs, enabled, tick]);

  return { data, error, loading, refresh, lastUpdated };
}

/**
 * Relative time, with the absolute value always available on hover.
 *
 * "3m ago" is what you want while scanning; the exact timestamp is what you want
 * when correlating with a log, so neither is dropped.
 */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "-";
  const then = typeof iso === "string" ? new Date(iso) : iso;
  const s = Math.round((Date.now() - then.getTime()) / 1000);
  if (Number.isNaN(s)) return "-";
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const formatAbsolute = (
  iso: string | Date | null | undefined,
): string =>
  iso
    ? new Date(iso)
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "Z")
    : "-";

/** Re-render on an interval so relative timestamps stay honest. */
export function useNow(intervalMs = 15000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useCopy(): [
  string | null,
  (text: string, label?: string) => void,
] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, label?: string) => {
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(label ?? text);
        setTimeout(() => setCopied(null), 1600);
      })
      .catch(() => {});
  }, []);
  return [copied, copy];
}

export type Hotkey = {
  keys: string;
  description: string;
  group: string;
  run: () => void;
};

/**
 * Global keyboard shortcuts.
 *
 * Deliberately inert while focus is in a text field — an operator typing a
 * member ID must not trigger navigation. Supports both single keys and
 * two-key sequences ("g i"), which is the convention every tool of this kind
 * has converged on.
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true): void {
  const pending = useRef<{ key: string; at: number } | null>(null);
  const table = useRef(hotkeys);
  table.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable);

      const key = e.key.toLowerCase();
      const combo = [
        e.metaKey || e.ctrlKey ? "mod" : "",
        e.shiftKey && e.key.length > 1 ? "shift" : "",
        key,
      ]
        .filter(Boolean)
        .join("+");

      // Modifier combos win outright and work even while typing.
      const modMatch = combo.startsWith("mod+")
        ? table.current.find((h) => h.keys === combo)
        : undefined;
      if (modMatch) {
        e.preventDefault();
        pending.current = null;
        return modMatch.run();
      }
      if (typing) return;

      /**
       * A pending sequence is resolved BEFORE any single-key binding.
       *
       * Otherwise a one-key shortcut shadows every sequence ending in the same
       * letter: `r` (toggle refresh) made `g r` (go to runs) unreachable,
       * because the direct match fired and cleared the pending `g`.
       */
      const prev = pending.current;
      if (prev && Date.now() - prev.at < 1200) {
        pending.current = null;
        const seq = table.current.find((h) => h.keys === `${prev.key} ${key}`);
        if (seq) {
          e.preventDefault();
          return seq.run();
        }
        // Not a known sequence: fall through and treat the key on its own.
      }

      // Start a sequence if this key prefixes one. Checked before single-key
      // bindings so a prefix key is never also an action.
      if (table.current.some((h) => h.keys.startsWith(`${key} `))) {
        pending.current = { key, at: Date.now() };
        e.preventDefault();
        return;
      }

      const direct = table.current.find((h) => h.keys === key);
      if (direct) {
        e.preventDefault();
        return direct.run();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
