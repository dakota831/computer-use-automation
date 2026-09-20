import { useCallback, useMemo, useRef, useState } from "react";
import { GripVertical, Lock } from "lucide-react";
import clsx from "clsx";
import { Mono } from "../shared/ui.tsx";

/**
 * Goal editor with template references.
 *
 * Two problems it solves. First, a goal that omits the sign-in step wastes a
 * discovery run, and every flow against this application starts the same way —
 * so that clause is fixed, shown, and not editable. Second, `{{memberId}}` and
 * `{{secret:corelink.password}}` have to be typed exactly or the recorder
 * cannot templatise them and the run silently bakes in a literal value. Making
 * the available references visible, clickable, draggable and autocompletable
 * removes the guesswork.
 */

export const GOAL_PREFIX = "Sign in to the teller console, ";

export type TemplateRef = {
  token: string;
  label: string;
  kind: "parameter" | "secret";
  hint: string;
};

/** Everything the recorder can substitute, given the current form state. */
export function buildReferences(
  paramName: string,
  secretKeys: string[],
): TemplateRef[] {
  const refs: TemplateRef[] = [];
  const p = paramName.trim();
  if (p) {
    refs.push({
      token: `{{${p}}}`,
      label: p,
      kind: "parameter",
      hint: "run parameter — the caller supplies this per invocation",
    });
  }
  for (const k of secretKeys) {
    refs.push({
      token: `{{secret:${k}}}`,
      label: `secret:${k}`,
      kind: "secret",
      hint: "resolved at typing time; the model never sees the value",
    });
  }
  return refs;
}

/**
 * The `{{…}}` token being typed immediately before the caret, if any.
 * Returns null once the token is closed, or if it contains anything that
 * could not be part of a reference.
 */
export function activeToken(
  value: string,
  caret: number,
): { start: number; partial: string } | null {
  const before = value.slice(0, caret);
  const open = before.lastIndexOf("{{");
  if (open === -1) return null;
  const between = before.slice(open + 2);
  if (!/^[\w.:-]*$/.test(between)) return null;
  return { start: open, partial: between };
}

/**
 * Prefix matching, not substring.
 *
 * `{{m` should offer `memberId` and nothing else. A substring match also
 * returned `secret:corelink.username`, because "username" happens to contain an
 * "m" — technically a match, useless as a suggestion. Segments split on `:` and
 * `.` are matched too, so `{{user` still finds `secret:corelink.username`
 * without `{{m` dragging it in.
 */
export function matchesPrefix(r: TemplateRef, partial: string): boolean {
  const p = partial.toLowerCase();
  if (p === "") return true;
  const label = r.label.toLowerCase();
  if (label.startsWith(p)) return true;
  return label.split(/[:.]/).some((seg) => seg.startsWith(p));
}

export function GoalEditor({
  value,
  onChange,
  references,
  rows = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  references: TemplateRef[];
  rows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState(0);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  /**
   * The token the operator dismissed with Escape.
   *
   * Without this, `keyUp` re-ran the detection immediately after `keyDown`
   * closed the list and it reopened on the same keystroke — Escape appeared to
   * do nothing. Suggestions return as soon as the token actually changes.
   */
  const dismissed = useRef<string | null>(null);

  const token = useMemo(
    () => (open ? activeToken(value, caret) : null),
    [open, value, caret],
  );

  const matches = useMemo(() => {
    if (!token) return [];
    return references.filter((r) => matchesPrefix(r, token.partial));
  }, [token, references]);

  const sync = (el: HTMLTextAreaElement) => {
    const c = el.selectionStart ?? 0;
    setCaret(c);
    const t = activeToken(el.value, c);
    const key = t ? `${t.start}:${t.partial}` : null;
    if (key !== null && dismissed.current === key) {
      setOpen(false);
      return;
    }
    dismissed.current = null;
    setOpen(t !== null);
    setSel(0);
  };

  /** Replace the partial token with a full reference and put the caret after it. */
  const accept = useCallback(
    (r: TemplateRef) => {
      const el = ref.current;
      const t = activeToken(value, caret);
      const start = t ? t.start : caret;
      const next = value.slice(0, start) + r.token + value.slice(caret);
      onChange(next);
      setOpen(false);
      requestAnimationFrame(() => {
        if (!el) return;
        const pos = start + r.token.length;
        el.focus();
        el.setSelectionRange(pos, pos);
        setCaret(pos);
      });
    },
    [value, caret, onChange],
  );

  /** Clicking a chip inserts at the caret; no need to aim. */
  const insert = (r: TemplateRef) => {
    const el = ref.current;
    const at = el?.selectionStart ?? value.length;
    const next =
      value.slice(0, at) + r.token + value.slice(el?.selectionEnd ?? at);
    onChange(next);
    requestAnimationFrame(() => {
      if (!el) return;
      const pos = at + r.token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || matches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, matches.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      accept(matches[sel]!);
    } else if (e.key === "Escape") {
      e.preventDefault();
      const t = activeToken(value, caret);
      dismissed.current = t ? `${t.start}:${t.partial}` : null;
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* The clause every flow against this application begins with. */}
      <div
        className="rule flex items-center gap-2 bg-paper-sunk px-2 py-1.5"
        title="Always included; not editable"
      >
        <Lock className="size-3.5 shrink-0 text-ink-faint" />
        <Mono className="text-ink-dim">{GOAL_PREFIX.trim()}</Mono>
        <span className="label-caps ml-auto text-ink-faint">fixed</span>
      </div>

      <textarea
        ref={ref}
        rows={rows}
        value={value}
        aria-label="Goal"
        placeholder="look up the member whose ID is {{memberId}}, open their record, and read the savings balance."
        onChange={(e) => {
          onChange(e.target.value);
          sync(e.target);
        }}
        onClick={(e) => sync(e.currentTarget)}
        onKeyUp={(e) => sync(e.currentTarget)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="rule min-w-0 bg-paper-sunk px-2 py-1.5 font-mono text-xs outline-none focus:bg-paper-raised"
      />

      {open && matches.length > 0 && (
        <ul
          role="listbox"
          aria-label="Template suggestions"
          className="rule -mt-1 bg-paper-raised shadow-hard-sm"
        >
          {matches.map((r, i) => (
            <li key={r.token}>
              <button
                type="button"
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(r);
                }}
                onMouseEnter={() => setSel(i)}
                className={clsx(
                  "flex w-full items-center gap-2 border-b border-rule-soft px-2 py-1.5 text-left last:border-0",
                  i === sel ? "bg-blue-pale" : "hover:bg-paper-sunk",
                )}
              >
                <Mono className="font-semibold">{r.token}</Mono>
                <span className="truncate text-[0.6875rem] text-ink-dim">
                  {r.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div>
        <p className="label-caps mb-1 text-ink-faint">
          References — click to insert, or drag into the goal
        </p>
        {references.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Name a parameter below and it will appear here as a reference.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {references.map((r) => (
              <li key={r.token}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    // text/plain drops natively into the textarea at the drop
                    // point, which fires input and updates the controlled value.
                    e.dataTransfer.setData("text/plain", r.token);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => insert(r)}
                  title={r.hint}
                  className={clsx(
                    "press rule inline-flex cursor-grab items-center gap-1 px-1.5 py-1 font-mono text-[0.6875rem] shadow-hard-sm active:cursor-grabbing",
                    r.kind === "secret"
                      ? "border-danger bg-danger-pale text-danger"
                      : "bg-blue-pale text-blue",
                  )}
                >
                  <GripVertical className="size-3 opacity-50" />
                  {r.token}
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-xs text-ink-faint">
          Type <Mono>{"{{"}</Mono> to autocomplete. A reference is substituted
          at run time — writing a literal value instead bakes it into the
          capability and it stops being reusable.
        </p>
      </div>
    </div>
  );
}
