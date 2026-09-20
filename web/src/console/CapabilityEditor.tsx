import { useState } from "react";
import { KeyRound, Plus, Trash2, GripVertical } from "lucide-react";
import clsx from "clsx";
import type { CapabilityDoc, OutcomeRule } from "./lib/api.ts";
import { Card, Button, Badge, Mono } from "../shared/ui.tsx";

/**
 * Editing a capability without reading JSON.
 *
 * A reviewer's job is narrow and specific: confirm the steps describe what they
 * expect, and write down what should happen when the application does something
 * other than succeed. Everything else — how each control is found, the policy,
 * the provenance — comes from the recording and should not be hand-edited.
 *
 * So this exposes exactly the reviewable surface, in plain language, and leaves
 * the raw document behind an "advanced" disclosure for the rare case that needs
 * it.
 */

/** A step the operator never has to think about: signing in. */
export function isSignInStep(doc: CapabilityDoc, index: number): boolean {
  const step = doc.steps[index];
  if (!step) return false;
  // Typing a credential is unambiguous.
  if (
    step.action.type === "type" &&
    (step.action.value ?? "").includes("{{secret:")
  )
    return true;
  // So is the submit immediately after the last one.
  const lastCredential = doc.steps.reduce(
    (acc, s, i) =>
      s.action.type === "type" && (s.action.value ?? "").includes("{{secret:")
        ? i
        : acc,
    -1,
  );
  return (
    lastCredential >= 0 &&
    index === lastCredential + 1 &&
    step.action.type === "click"
  );
}

/** How an outcome should be handled, in words an operator would use. */
export const DISPOSITIONS = [
  {
    value: "business_outcome",
    label: "Report it as the answer",
    hint: "A real result the caller needs, like “no such member”.",
  },
  {
    value: "recover",
    label: "Deal with it and carry on",
    hint: "A known interruption, like a notice to dismiss.",
  },
  {
    value: "escalate",
    label: "Ask a person",
    hint: "Pause and hand the session to an operator.",
  },
  {
    value: "fail",
    label: "Stop with an error",
    hint: "Something is genuinely wrong.",
  },
] as const;

export type OutcomeDraft = {
  code: string;
  describedAs: string;
  /** Screen text to match. Empty means "keep whatever the rule already had". */
  text: string;
  disposition: string;
  /** The rule as loaded, so an untouched detector survives a save unchanged. */
  original?: OutcomeRule;
};

/** Turn a title into the SHOUTY_CODE the result contract uses. */
export function toCode(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export function CapabilityEditor({
  doc,
  onSave,
  saving,
  error,
}: {
  doc: CapabilityDoc;
  onSave: (next: CapabilityDoc) => void;
  saving: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState(doc.title);
  const [description, setDescription] = useState(doc.description);
  const [intents, setIntents] = useState<Record<string, string>>(
    Object.fromEntries(doc.steps.map((s) => [s.id, s.intent])),
  );
  const [outcomes, setOutcomes] = useState<OutcomeDraft[]>(
    [...doc.steps.flatMap((s) => s.outcomes), ...doc.outcomes].map((o) => ({
      code: o.code,
      describedAs: o.describedAs,
      text: "",
      disposition: o.disposition,
      original: o,
    })),
  );
  const [adding, setAdding] = useState<OutcomeDraft>({
    code: "",
    describedAs: "",
    text: "",
    disposition: "business_outcome",
  });

  const visible = doc.steps
    .map((_, i) => i)
    .filter((i) => !isSignInStep(doc, i));
  const hidden = doc.steps.length - visible.length;

  const save = () => {
    /**
     * Only the reviewable fields are written back. Capability-wide outcomes
     * carry the whole edited table; per-step ones are cleared so a rule cannot
     * silently exist twice.
     */
    onSave({
      ...doc,
      title: title.trim() || doc.title,
      description: description.trim() || doc.description,
      steps: doc.steps.map((s) => ({
        ...s,
        intent: intents[s.id] ?? s.intent,
        outcomes: [],
      })),
      outcomes: outcomes
        .filter((o) => o.code && o.describedAs)
        .map((o) => ({
          ...(o.original ?? {}),
          code: o.code,
          describedAs: o.describedAs,
          disposition: o.disposition,
          // New text replaces the detector; no text keeps the one that already
          // works. Regenerating it from the description would substitute a
          // guess for a tested match.
          detector: o.text
            ? { kind: "text_present", text: o.text, match: "normalized" }
            : (o.original?.detector ?? {
                kind: "text_present",
                text: o.describedAs,
                match: "normalized",
              }),
          maxAttempts:
            o.original?.maxAttempts ?? (o.disposition === "recover" ? 2 : 1),
        })) as CapabilityDoc["outcomes"],
    });
  };

  const addOutcome = () => {
    if (!adding.describedAs.trim()) return;
    setOutcomes([
      ...outcomes,
      { ...adding, code: adding.code || toCode(adding.describedAs) },
    ]);
    setAdding({
      code: "",
      describedAs: "",
      text: "",
      disposition: "business_outcome",
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Card title="What it is">
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="label-caps text-ink-faint">Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              aria-label="Capability title"
              className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm outline-none focus:bg-paper-raised"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-caps text-ink-faint">Description</span>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Capability description"
              className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm outline-none focus:bg-paper-raised"
            />
          </label>
        </div>
      </Card>

      <Card title="What it does">
        {hidden > 0 && (
          <p className="rule mb-3 flex items-center gap-2 bg-paper-sunk px-2 py-1.5 text-xs text-ink-dim">
            <KeyRound className="size-3.5 shrink-0 text-ink-faint" />
            Signs in automatically as the configured teller.
            <span className="label-caps ml-auto text-ink-faint">
              {hidden} steps hidden
            </span>
          </p>
        )}
        <ol className="flex flex-col gap-2">
          {visible.map((i, n) => {
            const s = doc.steps[i]!;
            return (
              <li
                key={s.id}
                className="rule flex items-start gap-2 bg-paper-sunk p-2"
              >
                <GripVertical className="mt-1.5 size-3.5 shrink-0 text-ink-faint opacity-40" />
                <span className="mt-1 font-mono text-xs text-ink-faint">
                  {n + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <input
                    value={intents[s.id] ?? ""}
                    onChange={(e) =>
                      setIntents({ ...intents, [s.id]: e.target.value })
                    }
                    aria-label={`Step ${n + 1} description`}
                    className="w-full min-w-0 bg-transparent text-sm outline-none"
                  />
                  <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                    {s.action.type === "type"
                      ? `types ${s.action.value ?? ""} into ${s.action.target?.describedAs ?? "a field"}`
                      : s.action.type === "click"
                        ? `clicks ${s.action.target?.describedAs ?? "a control"}`
                        : s.action.type}
                  </p>
                </div>
                {s.riskClass !== "safe" && (
                  <Badge
                    tone={s.riskClass === "irreversible" ? "danger" : "warn"}
                  >
                    {s.riskClass}
                  </Badge>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-faint">
          You can reword what a step is for. How each control is found comes
          from the recording and is not edited by hand.
        </p>
      </Card>

      <Card title="What can go wrong">
        <p className="mb-3 text-xs text-ink-dim">
          This is the part a recording cannot know. One successful run only ever
          saw things go right — tell it what the other answers look like, so a
          caller gets a real result instead of an error.
        </p>

        {outcomes.length > 0 && (
          <ul className="mb-3 flex flex-col gap-2">
            {outcomes.map((o, i) => (
              <li
                key={`${o.code}-${i}`}
                className="rule flex items-start gap-2 bg-paper-sunk p-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{o.describedAs}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-ink-faint">
                    <Mono>{o.code}</Mono> ·{" "}
                    {DISPOSITIONS.find((d) => d.value === o.disposition)
                      ?.label ?? o.disposition}
                  </p>
                </div>
                <button
                  onClick={() =>
                    setOutcomes(outcomes.filter((_, n) => n !== i))
                  }
                  aria-label={`Remove ${o.describedAs}`}
                  className="press shrink-0 text-ink-faint hover:text-danger"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="rule border-dashed p-2.5">
          <p className="label-caps mb-2 text-ink-faint">Add one</p>
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-dim">What happened?</span>
              <input
                value={adding.describedAs}
                onChange={(e) =>
                  setAdding({ ...adding, describedAs: e.target.value })
                }
                placeholder="no member exists with that ID"
                aria-label="What happened"
                className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm outline-none focus:bg-paper-raised"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-dim">
                How would you know? Text that appears on screen.
              </span>
              <input
                value={adding.text}
                onChange={(e) => setAdding({ ...adding, text: e.target.value })}
                placeholder="No member found matching the ID supplied"
                aria-label="Text that appears on screen"
                className="rule min-w-0 bg-paper-sunk px-2 py-1.5 font-mono text-xs outline-none focus:bg-paper-raised"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-dim">
                What should happen then?
              </span>
              <select
                value={adding.disposition}
                onChange={(e) =>
                  setAdding({ ...adding, disposition: e.target.value })
                }
                aria-label="What should happen"
                className="rule min-w-0 bg-paper-sunk px-2 py-1.5 text-sm"
              >
                {DISPOSITIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
              <span className="text-[0.6875rem] text-ink-faint">
                {DISPOSITIONS.find((d) => d.value === adding.disposition)?.hint}
              </span>
            </label>
            <Button
              size="sm"
              onClick={addOutcome}
              disabled={!adding.describedAs.trim() || !adding.text.trim()}
            >
              <Plus className="size-4" /> Add
            </Button>
          </div>
        </div>
      </Card>

      {error && (
        <div className="rule border-danger bg-danger-pale p-2 text-xs break-words text-danger">
          {error}
        </div>
      )}

      <div className={clsx("flex gap-2")}>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
