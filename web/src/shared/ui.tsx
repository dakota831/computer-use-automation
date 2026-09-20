import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

/**
 * Brutalist primitives.
 *
 * Every control is a hard-edged box with a 2px rule and an offset shadow, and
 * pressing it moves the box onto its own shadow. That single interaction makes
 * the whole tool feel physical and, more usefully, makes it unambiguous what is
 * and is not clickable — which matters more in an operations console than in a
 * marketing page, because the cost of a misclick here is a banking action.
 */

type Variant = "primary" | "default" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue text-white border-rule",
  default: "bg-paper-raised text-ink border-rule",
  danger: "bg-danger text-white border-rule",
  ghost: "bg-transparent text-ink border-transparent hover:border-rule",
};

export function Button({
  variant = "default",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
}) {
  return (
    <button
      {...rest}
      className={clsx(
        "press inline-flex items-center gap-2 border-2 font-medium",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant !== "ghost" && "shadow-hard-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "live";

const TONES: Record<Tone, string> = {
  neutral: "bg-paper-sunk text-ink-dim border-rule-soft",
  ok: "bg-ok-pale text-ok border-ok",
  warn: "bg-warn-pale text-warn border-warn",
  danger: "bg-danger-pale text-danger border-danger",
  info: "bg-blue-pale text-blue border-blue",
  live: "bg-blue-pale text-live border-live",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "label-caps inline-flex items-center gap-1.5 border-2 px-1.5 py-0.5",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Maps a capability/run status to a consistent tone across every screen. */
export function StatusBadge({ status }: { status: string }) {
  const tone: Tone =
    status === "success" || status === "approved"
      ? "ok"
      : status === "outcome" || status === "draft"
        ? "warn"
        : status === "failed" || status === "deprecated"
          ? "danger"
          : status === "escalated" || status === "pending"
            ? "info"
            : status === "operator_controlling" || status === "running"
              ? "live"
              : "neutral";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export function Card({
  title,
  aside,
  children,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & {
  title?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section
      {...rest}
      className={clsx("rule min-w-0 bg-paper-raised shadow-hard", className)}
    >
      {title && (
        <header className="rule-b flex min-w-0 items-center gap-3 bg-paper-sunk px-3 py-2">
          <h2 className="label-caps min-w-0 truncate">{title}</h2>
          {aside && (
            <div className="ml-auto flex items-center gap-2">{aside}</div>
          )}
        </header>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}

/** Label + value row, the workhorse of every detail panel. */
export function Field({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3">
      <dt className="label-caps shrink-0 pt-0.5 text-ink-faint sm:w-44">
        {label}
      </dt>
      <dd
        className={clsx(
          "min-w-0 max-w-full break-all whitespace-pre-wrap text-sm",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

export const Mono = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => <span className={clsx("font-mono text-xs", className)}>{children}</span>;

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rule bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.6875rem] leading-none shadow-hard-sm">
      {children}
    </kbd>
  );
}

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="hatch rule border-dashed p-10 text-center">
      <p className="label-caps">{title}</p>
      {detail && (
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-dim">{detail}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rule h-10 animate-pulse bg-paper-sunk" />
      ))}
    </div>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rule border-danger bg-danger-pale p-4">
      <p className="label-caps text-danger">Request failed</p>
      <p className="mt-1 font-mono text-xs break-words text-danger">{error}</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/** Scrollable on small screens rather than reflowing: these are dense data tables. */
export function TableWrap({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-3 min-w-0 max-w-full overflow-x-auto px-3">
      <table className="w-full min-w-[30rem] border-collapse text-sm">
        {children}
      </table>
    </div>
  );
}

export const Th = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => (
  <th
    className={clsx(
      "label-caps rule-b border-rule-soft px-2 py-1.5 text-left text-ink-faint",
      className,
    )}
  >
    {children}
  </th>
);

export const Td = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => (
  <td
    className={clsx(
      "border-b border-rule-soft px-2 py-1.5 align-top",
      className,
    )}
  >
    {children}
  </td>
);
