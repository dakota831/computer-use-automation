import { useMemo, useState } from "react";
import {
  Routes,
  Route,
  Link,
  useLocation,
  useNavigate,
  Navigate,
} from "react-router-dom";
import { Command, Keyboard, RefreshCw, Pause, Play } from "lucide-react";
import clsx from "clsx";
import { Header, Footer } from "../shared/Chrome.tsx";
import { Kbd, Badge } from "../shared/ui.tsx";
import { useHotkeys, useLocalStorage, type Hotkey } from "../shared/hooks.ts";
import { CommandPalette } from "./CommandPalette.tsx";
import { Overview } from "./pages/Overview.tsx";
import { Capabilities } from "./pages/Capabilities.tsx";
import { CapabilityDetail } from "./pages/CapabilityDetail.tsx";
import { NewCapability } from "./pages/NewCapability.tsx";
import { Diff } from "./pages/Diff.tsx";
import { Interventions } from "./pages/Interventions.tsx";
import { SessionView } from "./pages/SessionView.tsx";
import { Runs } from "./pages/Runs.tsx";
import { RunDetail } from "./pages/RunDetail.tsx";

/**
 * Operator console shell.
 *
 * Navigation, keyboard access and the auto-refresh control live here so every
 * page inherits them. The refresh preference is global and persisted on purpose:
 * an operator who paused refresh to read a stack trace does not want it to
 * silently resume when they navigate.
 */

const NAV = [
  { label: "Overview", href: "/" },
  { label: "Interventions", href: "/interventions" },
  { label: "Capabilities", href: "/capabilities" },
  { label: "Runs", href: "/runs" },
];

export type RefreshPrefs = { auto: boolean; setAuto: (v: boolean) => void };

export default function App() {
  const loc = useLocation();
  const nav = useNavigate();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [auto, setAuto] = useLocalStorage("dex.autorefresh", true);

  const hotkeys: Hotkey[] = useMemo(
    () => [
      {
        keys: "mod+k",
        description: "Open command palette",
        group: "General",
        run: () => setPaletteOpen(true),
      },
      {
        keys: "?",
        description: "Keyboard shortcuts",
        group: "General",
        run: () => setHelpOpen((o) => !o),
      },
      {
        keys: "escape",
        description: "Close overlay",
        group: "General",
        run: () => (setPaletteOpen(false), setHelpOpen(false)),
      },
      {
        keys: "g o",
        description: "Go to overview",
        group: "Navigate",
        run: () => nav("/"),
      },
      {
        keys: "g i",
        description: "Go to interventions",
        group: "Navigate",
        run: () => nav("/interventions"),
      },
      {
        keys: "g c",
        description: "Go to capabilities",
        group: "Navigate",
        run: () => nav("/capabilities"),
      },
      {
        keys: "g r",
        description: "Go to runs",
        group: "Navigate",
        run: () => nav("/runs"),
      },
      {
        keys: "g n",
        description: "Teach a new capability",
        group: "Navigate",
        run: () => nav("/capabilities/new"),
      },
      {
        keys: "g d",
        description: "Compare capabilities",
        group: "Navigate",
        run: () => nav("/capabilities/compare"),
      },
      {
        keys: "r",
        description: "Toggle auto-refresh",
        group: "View",
        run: () => setAuto(!auto),
      },
    ],
    [nav, auto, setAuto],
  );
  useHotkeys(hotkeys);

  const navItems = NAV.map((n) => ({
    ...n,
    active:
      n.href === "/" ? loc.pathname === "/" : loc.pathname.startsWith(n.href),
  }));

  const prefs: RefreshPrefs = { auto, setAuto };

  return (
    <div className="flex min-h-full flex-col">
      <Header
        sub="Operator Console"
        nav={navItems}
        homeHref="/"
        right={
          <>
            <button
              onClick={() => setAuto(!auto)}
              title={`${auto ? "Pause" : "Resume"} auto-refresh  (r)`}
              aria-label={`${auto ? "Pause" : "Resume"} auto-refresh`}
              className="press inline-flex items-center gap-1.5 border-2 border-white/40 px-2 py-1.5 text-xs text-white"
            >
              {auto ? (
                <Pause className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              <span className="label-caps hidden sm:inline">
                {auto ? "Live" : "Paused"}
              </span>
            </button>
            <button
              onClick={() => setPaletteOpen(true)}
              title="Command palette (⌘K)"
              aria-label="Open command palette"
              className="press inline-flex items-center gap-1.5 border-2 border-white/40 px-2 py-1.5 text-xs text-white"
            >
              <Command className="size-3.5" />
              <span className="label-caps hidden sm:inline">⌘K</span>
            </button>
          </>
        }
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-5 sm:px-5">
        <Routes>
          <Route path="/" element={<Overview prefs={prefs} />} />
          <Route
            path="/interventions"
            element={<Interventions prefs={prefs} />}
          />
          <Route path="/session/:id" element={<SessionView />} />
          <Route path="/capabilities" element={<Capabilities />} />
          {/* static segments before the dynamic one */}
          <Route path="/capabilities/new" element={<NewCapability />} />
          <Route path="/capabilities/compare" element={<Diff />} />
          <Route path="/capabilities/:ref" element={<CapabilityDetail />} />
          <Route path="/runs" element={<Runs prefs={prefs} />} />
          <Route path="/runs/:id" element={<RunDetail />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer
        note={
          <button
            onClick={() => setHelpOpen(true)}
            className="flex items-center gap-1.5 hover:text-blue"
          >
            <Keyboard className="size-3.5" /> Keyboard shortcuts <Kbd>?</Kbd>
          </button>
        }
      />

      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {helpOpen && (
        <ShortcutHelp hotkeys={hotkeys} onClose={() => setHelpOpen(false)} />
      )}
    </div>
  );
}

/** Breadcrumbs, shared by every detail page. */
export function Crumbs({ trail }: { trail: { label: string; to?: string }[] }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-3 flex flex-wrap items-center gap-1.5 text-xs"
    >
      {trail.map((c, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && (
            <span className="text-ink-faint" aria-hidden>
              /
            </span>
          )}
          {c.to ? (
            <Link
              to={c.to}
              className="text-blue underline-offset-2 hover:underline"
            >
              {c.label}
            </Link>
          ) : (
            <span className="text-ink-dim">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

/** Page heading with an optional refresh affordance and "last updated". */
export function PageHead({
  title,
  lede,
  right,
  lastUpdated,
  onRefresh,
}: {
  title: string;
  lede?: string;
  right?: React.ReactNode;
  lastUpdated?: Date | null;
  onRefresh?: () => void;
}) {
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-end gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          {title}
        </h1>
        {lede && (
          <p className="mt-0.5 max-w-2xl text-sm text-ink-dim">{lede}</p>
        )}
      </div>
      <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
        {lastUpdated && (
          <span className="hidden font-mono text-[0.6875rem] text-ink-faint sm:inline">
            updated {lastUpdated.toLocaleTimeString()}
          </span>
        )}
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Refresh"
            title="Refresh"
            className="press rule bg-paper-raised p-1.5 shadow-hard-sm"
          >
            <RefreshCw className="size-4" />
          </button>
        )}
        {right}
      </div>
    </div>
  );
}

function ShortcutHelp({
  hotkeys,
  onClose,
}: {
  hotkeys: Hotkey[];
  onClose: () => void;
}) {
  const groups = hotkeys.reduce<Record<string, Hotkey[]>>((acc, h) => {
    (acc[h.group] ??= []).push(h);
    return acc;
  }, {});
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-40 flex items-center justify-center bg-navy-deep/60 p-4"
      onClick={onClose}
    >
      <div
        className="rule w-full max-w-lg bg-paper-raised shadow-hard-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rule-b flex items-center bg-paper-sunk px-3 py-2">
          <h2 className="label-caps">Keyboard shortcuts</h2>
          <Badge className="ml-auto">esc to close</Badge>
        </header>
        <div className="grid gap-4 p-3 sm:grid-cols-2">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="label-caps mb-1.5 text-ink-faint">{group}</p>
              <ul className="flex flex-col gap-1.5">
                {items.map((h) => (
                  <li
                    key={h.keys}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-ink-dim">{h.description}</span>
                    <span className="flex gap-1">
                      {h.keys.split(" ").map((k) => (
                        <Kbd key={k}>{k.replace("mod", "⌘")}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export const cx = clsx;
