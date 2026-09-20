import type { ReactNode } from "react";
import { Inbox, BookMarked, Monitor } from "lucide-react";
import clsx from "clsx";

export type View = "interventions" | "session" | "catalog";

const NAV: { view: View; href: string; label: string; Icon: typeof Inbox }[] = [
  { view: "interventions", href: "#/", label: "Interventions", Icon: Inbox },
  {
    view: "catalog",
    href: "#/catalog",
    label: "Capabilities",
    Icon: BookMarked,
  },
];

export function Layout({
  view,
  children,
}: {
  view: View;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-6 border-b border-edge bg-surface-raised px-5 py-3">
        <div className="flex items-center gap-2 font-semibold tracking-tight">
          <Monitor className="size-4 text-accent" />
          Operator Console
        </div>
        <nav className="flex gap-1">
          {NAV.map(({ view: v, href, label, Icon }) => (
            <a
              key={v}
              href={href}
              className={clsx(
                "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition",
                view === v
                  ? "bg-accent/15 text-accent"
                  : "text-ink-dim hover:bg-white/5",
              )}
            >
              <Icon className="size-4" />
              {label}
            </a>
          ))}
        </nav>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-5">{children}</main>
    </div>
  );
}
