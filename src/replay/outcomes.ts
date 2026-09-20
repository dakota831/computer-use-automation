import type { Assertion, Checkpoint } from "../core/assertions.js";
import type { OutcomeRule, OutputSpec } from "../core/artifact.js";
import type { TargetDescriptor } from "../core/targeting.js";
import { resolveTemplate, type SecretProvider } from "../core/template.js";
import {
  normalizeName,
  type Observation,
  type Surface,
} from "../surface/types.js";

/**
 * Assertion evaluation, outcome detection and output extraction.
 *
 * One evaluator serves all three jobs deliberately (see DECISIONS.md D5). The
 * consequence that matters: detecting "no such member" runs through exactly the
 * same code path as confirming success, so the system cannot be good at one and
 * sloppy at the other.
 */

export type EvalContext = {
  surface: Surface;
  observation: Observation;
  inputs: Record<string, unknown>;
  secrets?: SecretProvider;
};

export type AssertionResult = {
  ok: boolean;
  describe: string;
  observed?: string;
};

export async function evaluateAssertion(
  a: Assertion,
  ctx: EvalContext,
): Promise<AssertionResult> {
  switch (a.kind) {
    case "url_matches": {
      /**
       * In a frameset application "the URL" is ambiguous: the address bar still
       * shows the shell while all the actual navigation happens inside a frame.
       * Matching only the top-level URL means a checkpoint can never observe
       * that the app moved - which is exactly what it is for. So the pattern is
       * tested against the top document and every frame.
       */
      const re = new RegExp(a.pattern);
      const urls = [
        ctx.observation.url,
        ...ctx.observation.frames.map((f) => f.url),
      ];
      const hit = urls.find((u) => re.test(u));
      return {
        ok: hit !== undefined,
        describe: `url matches /${a.pattern}/`,
        observed: hit ?? urls.join(" , "),
      };
    }

    case "text_present":
    case "text_absent": {
      const haystack = await scopedText(a.within, ctx);
      const present = textMatches(
        haystack,
        a.kind === "text_present" ? a.text : a.text,
        matchModeOf(a),
      );
      const ok = a.kind === "text_present" ? present : !present;
      return {
        ok,
        describe: `${a.kind === "text_present" ? "text present" : "text absent"}: "${a.text}"`,
        observed: present
          ? `found "${a.text}"`
          : `not found in ${haystack.length} chars of visible text`,
      };
    }

    case "element_present":
    case "element_absent": {
      const r = await ctx.surface.resolve(a.target, ctx.observation);
      const found = r.ok;
      const ok = a.kind === "element_present" ? found : !found;
      return {
        ok,
        describe: `${a.kind === "element_present" ? "element present" : "element absent"}: ${a.target.describedAs}`,
        observed: r.ok
          ? `resolved ${r.node.role} "${r.node.label}"`
          : `not resolved (${r.reason})`,
      };
    }

    case "value_equals": {
      const r = await ctx.surface.resolve(a.target, ctx.observation);
      if (!r.ok)
        return {
          ok: false,
          describe: `value of ${a.target.describedAs}`,
          observed: `target not resolved (${r.reason})`,
        };
      const actual = await ctx.surface.readText(r.node);
      const expected = resolveTemplate(a.expected, ctx.inputs, ctx.secrets);
      return {
        ok: normalizeName(actual) === normalizeName(expected),
        describe: `${a.target.describedAs} equals "${expected}"`,
        observed: actual,
      };
    }
  }
}

const matchModeOf = (a: Assertion): "exact" | "normalized" | "regex" =>
  a.kind === "text_present" ? a.match : "normalized";

function textMatches(
  haystack: string,
  needle: string,
  mode: "exact" | "normalized" | "regex",
): boolean {
  if (mode === "regex") return new RegExp(needle, "i").test(haystack);
  if (mode === "exact") return haystack.includes(needle);
  return normalizeName(haystack).includes(normalizeName(needle));
}

/**
 * Scoping matters more than it looks. "Error" appearing anywhere on a page is
 * not the same as "Error" in the message region, and an unscoped text assertion
 * will happily match a hidden template or a nav label.
 */
async function scopedText(
  within: TargetDescriptor | undefined,
  ctx: EvalContext,
): Promise<string> {
  if (!within) return ctx.observation.text;
  const r = await ctx.surface.resolve(within, ctx.observation);
  if (!r.ok) return "";
  return ctx.surface.readText(r.node);
}

export type CheckpointResult =
  | { ok: true; attempts: number }
  | { ok: false; attempts: number; failed: AssertionResult[] };

/**
 * Wait for a checkpoint to hold.
 *
 * Polling with re-observation rather than a fixed sleep: the brief's environment
 * has real transient slowness, and a checkpoint that is simply not true *yet* is
 * the single most common recoverable condition. The budget is the checkpoint's
 * own declared timeout, so waiting is bounded by the artifact rather than by a
 * global constant somebody has to guess.
 */
export async function waitForCheckpoint(
  cp: Checkpoint,
  ctx: EvalContext,
  reobserve: () => Promise<Observation>,
  pollMs = 400,
): Promise<CheckpointResult> {
  const deadline = Date.now() + cp.timeoutMs;
  let attempts = 0;
  let failed: AssertionResult[] = [];

  for (;;) {
    attempts++;
    const results: AssertionResult[] = [];
    for (const a of cp.all) results.push(await evaluateAssertion(a, ctx));
    failed = results.filter((r) => !r.ok);
    if (failed.length === 0) return { ok: true, attempts };
    if (Date.now() >= deadline) return { ok: false, attempts, failed };
    await new Promise((r) => setTimeout(r, pollMs));
    ctx = { ...ctx, observation: await reobserve() };
  }
}

/**
 * Find the first outcome rule whose detector matches.
 *
 * Order is significant and comes from the artifact: rules are evaluated in the
 * order a human recorded them, so a specific detector ("no member found") can be
 * placed ahead of a general one ("an error box is showing").
 */
export async function detectOutcome(
  rules: OutcomeRule[],
  ctx: EvalContext,
): Promise<{ rule: OutcomeRule; observed?: string } | null> {
  for (const rule of rules) {
    const r = await evaluateAssertion(rule.detector, ctx);
    if (r.ok) return { rule, observed: r.observed };
  }
  return null;
}

/** Read the capability's declared outputs off the final screen. */
export async function extractOutputs(
  specs: OutputSpec[],
  ctx: EvalContext,
): Promise<{ outputs: Record<string, unknown>; missing: string[] }> {
  const outputs: Record<string, unknown> = {};
  const missing: string[] = [];

  for (const spec of specs) {
    const r = await ctx.surface.resolve(spec.source, ctx.observation);
    if (!r.ok) {
      missing.push(spec.name);
      continue;
    }
    let value: unknown = await ctx.surface.readText(r.node);

    for (const t of spec.transform) {
      const s = String(value);
      switch (t.op) {
        case "trim":
          value = s.trim();
          break;
        case "strip":
          value = s.replace(new RegExp(`[${escapeClass(t.chars)}]`, "g"), "");
          break;
        case "regex_extract": {
          const m = s.match(new RegExp(t.pattern));
          value = m?.[t.group] ?? "";
          break;
        }
        case "to_number":
          value = Number(s);
          break;
      }
    }

    // Coerce to the declared type, so a caller gets what the contract promised
    // rather than whatever the screen happened to contain.
    if (spec.type === "number" && typeof value !== "number") {
      const n = Number(String(value).replace(/[$,\s]/g, ""));
      value = Number.isFinite(n) ? n : undefined;
    }
    if (value === undefined || value === "") missing.push(spec.name);
    else outputs[spec.name] = value;
  }

  return { outputs, missing };
}

const escapeClass = (s: string) => s.replace(/[\]\\^-]/g, "\\$&");
