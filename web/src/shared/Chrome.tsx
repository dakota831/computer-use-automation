import { useState, type ReactNode } from "react";
import { Copy, Check, Menu, X } from "lucide-react";
import clsx from "clsx";
import { useCopy } from "./hooks.ts";
import { useToast } from "./Toast.tsx";

/** The mark: a solid "record" block beside an open "replay" chevron. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="DexDash"
      className="shrink-0"
    >
      <rect width="32" height="32" fill="#0b2545" />
      <rect
        x="3"
        y="3"
        width="26"
        height="26"
        fill="none"
        stroke="#f4f6fb"
        strokeWidth="2"
      />
      <rect x="7" y="7" width="7" height="18" fill="#f4f6fb" />
      <path d="M17 7 L26 16 L17 25 Z" fill="#3b82f6" />
    </svg>
  );
}

export function Wordmark({ sub }: { sub?: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-base font-bold tracking-tight">DexDash</span>
      {sub && (
        <span className="label-caps hidden text-ink-faint sm:inline">
          {sub}
        </span>
      )}
    </span>
  );
}

/** Copy-to-clipboard with visible confirmation. Used on every id, path and code. */
export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, copy] = useCopy();
  const toast = useToast();
  const done = copied !== null;
  return (
    <button
      onClick={() => {
        copy(value, label);
        toast(`Copied ${label ?? "to clipboard"}`, "ok");
      }}
      title={`Copy ${label ?? value}`}
      aria-label={`Copy ${label ?? value}`}
      className={clsx(
        "press inline-flex items-center opacity-60 hover:opacity-100",
        className,
      )}
    >
      {done ? (
        <Check className="size-3.5 text-ok" />
      ) : (
        <Copy className="size-3.5" />
      )}
    </button>
  );
}

export type NavItem = {
  label: string;
  href: string;
  active?: boolean;
  external?: boolean;
};

/**
 * Shared header. Collapses to a disclosure menu under `sm`, because an operator
 * checking an escalation from a phone is a realistic case, not a nicety.
 */
export function Header({
  sub,
  nav,
  right,
  homeHref = "/",
}: {
  sub?: string;
  nav: NavItem[];
  right?: ReactNode;
  homeHref?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="rule-b sticky top-0 z-30 bg-navy text-white">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 sm:px-5">
        <a
          href={homeHref}
          className="flex items-center gap-2.5 text-white no-underline"
        >
          <Logo />
          <Wordmark sub={sub} />
        </a>

        <nav aria-label="Primary" className="ml-4 hidden gap-1 md:flex">
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              {...(n.external ? { target: "_blank", rel: "noreferrer" } : {})}
              className={clsx(
                "label-caps border-2 px-2.5 py-1.5 no-underline transition-colors",
                n.active
                  ? "border-white bg-white text-navy"
                  : "border-transparent text-white/75 hover:text-white",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {right}
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-label="Toggle navigation"
            className="press border-2 border-white/40 p-1.5 md:hidden"
          >
            {open ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {open && (
        <nav
          aria-label="Primary mobile"
          className="rule-t flex flex-col border-white/25 md:hidden"
        >
          {nav.map((n) => (
            <a
              key={n.href}
              href={n.href}
              {...(n.external ? { target: "_blank", rel: "noreferrer" } : {})}
              className={clsx(
                "label-caps border-b border-white/15 px-4 py-3 no-underline",
                n.active ? "bg-white text-navy" : "text-white/85",
              )}
            >
              {n.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}

/**
 * Cross-surface links.
 *
 * Absolute on purpose: this footer is shared between the public site and the
 * console, which are different origins. Relative hrefs looked correct on the
 * site and silently pointed at console pages once the same footer rendered
 * there — "How it works" landed on the console's own overview instead of the
 * explainer.
 */
export const SURFACES = {
  site: "https://dexdash.cloud",
  teller: "https://teller.dexdash.cloud",
  console: "https://console.dexdash.cloud",
  api: "https://api.dexdash.cloud/api/capabilities",
  repo: "https://github.com/dakota831/computer-use-automation",
} as const;

export type SurfaceName = "site" | "console";

export function Footer({
  note,
  current,
}: {
  note?: ReactNode;
  /** Which surface is rendering this, so its own entry is not offered as a link. */
  current?: SurfaceName;
}) {
  return (
    <footer className="rule-t mt-10 bg-paper-sunk">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-3 py-6 sm:px-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <Logo size={24} />
          <div>
            <p className="text-sm font-bold">DexDash</p>
            <p className="mt-0.5 max-w-sm text-xs text-ink-dim">
              Record-once / replay-many automation for legacy back-office
              applications.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs sm:grid-cols-3">
          <FooterCol
            title="Interfaces"
            links={[
              { label: "Teller app", href: SURFACES.teller },
              {
                label: "Operator console",
                href: SURFACES.console,
                here: current === "console",
              },
              { label: "Capability API", href: SURFACES.api },
            ]}
          />
          <FooterCol
            title="Learn"
            links={[
              {
                label: "What DexDash is",
                href: SURFACES.site,
                here: current === "site",
              },
              { label: "How it works", href: `${SURFACES.site}/#how` },
              { label: "Safety model", href: `${SURFACES.site}/#safety` },
            ]}
          />
          <FooterCol
            title="Source"
            links={[{ label: "Repository", href: SURFACES.repo }]}
          />
        </div>
      </div>

      <div className="rule-t border-rule-soft">
        <div className="mx-auto flex max-w-7xl flex-col gap-1 px-3 py-3 text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            <strong className="text-ink-dim">All data is synthetic.</strong> No
            real institution, member, account or credential is represented
            anywhere in this system.
          </p>
          {note}
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string; here?: boolean }[];
}) {
  return (
    <div>
      <p className="label-caps mb-1.5 text-ink-faint">{title}</p>
      <ul className="flex flex-col gap-1">
        {links.map((l) => (
          <li key={l.href}>
            {l.here ? (
              // Already here; a link back to the current surface is noise.
              <span className="text-ink-faint" aria-current="page">
                {l.label}
              </span>
            ) : (
              <a
                href={l.href}
                className="text-ink-dim underline-offset-2 hover:text-blue hover:underline"
              >
                {l.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
