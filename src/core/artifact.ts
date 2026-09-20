import { z } from "zod";
import { TargetDescriptor } from "./targeting.js";
import { Assertion, Checkpoint } from "./assertions.js";

export const SCHEMA_VERSION = "1.0.0";

/**
 * Data sensitivity. Drives redaction in logs, evidence and artifacts.
 * Declared per parameter and per output because the engine cannot infer it:
 * a member ID looks like any other string.
 */
export const Sensitivity = z.enum([
  "public", // safe to log verbatim
  "internal", // logged, not published in evidence
  "pii", // redacted to a type tag + length, never stored raw
  "secret", // never enters a log, an artifact, or the model context at all
]);
export type Sensitivity = z.infer<typeof Sensitivity>;

/**
 * Risk classification, assigned per step.
 *
 * `safe`         - reads, navigation, typing into a field. Reversible.
 * `risky`        - mutates state but is correctable (saving a draft, updating a field).
 * `irreversible` - posts a transaction, sends money, deletes. No undo.
 *
 * The policy engine treats these very differently (see policy.ts). Recorded on
 * the step rather than inferred at replay time so that the risk surface of a
 * capability is reviewable *before* it is ever approved to run unattended.
 */
export const RiskClass = z.enum(["safe", "risky", "irreversible"]);
export type RiskClass = z.infer<typeof RiskClass>;

/** Typed input the calling agent supplies per invocation. */
export const ParamSpec = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(["string", "number", "boolean", "date"]),
  required: z.boolean().default(true),
  description: z.string(),
  sensitivity: Sensitivity.default("internal"),
  /** Validated before the browser is even launched - cheapest possible failure. */
  pattern: z.string().optional(),
  enum: z.array(z.string()).optional(),
  /** Deliberately synthetic. Real values must never be committed to an artifact. */
  example: z.string().optional(),
});
export type ParamSpec = z.infer<typeof ParamSpec>;

/** Typed value the capability returns to its caller. */
export const OutputSpec = z.object({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/),
  type: z.enum(["string", "number", "boolean", "date"]),
  description: z.string(),
  sensitivity: Sensitivity.default("internal"),
  /** Where on the screen the value comes from. */
  source: TargetDescriptor,
  /** Applied in order to turn screen text into the declared type, e.g. strip "$" and "," before Number. */
  transform: z
    .array(
      z.discriminatedUnion("op", [
        z.object({ op: z.literal("trim") }),
        z.object({ op: z.literal("strip"), chars: z.string() }),
        z.object({
          op: z.literal("regex_extract"),
          pattern: z.string(),
          group: z.number().int().default(1),
        }),
        z.object({ op: z.literal("to_number") }),
      ]),
    )
    .default([]),
});
export type OutputSpec = z.infer<typeof OutputSpec>;

/** What the agent physically does to the surface. Kept small on purpose. */
export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string() }),
  z.object({ type: z.literal("click"), target: TargetDescriptor }),
  z.object({
    type: z.literal("type"),
    target: TargetDescriptor,
    /** Template. "{{memberId}}" resolves from inputs; "{{secret:app.password}}" from the vault, never logged. */
    value: z.string(),
    clearFirst: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("select"),
    target: TargetDescriptor,
    value: z.string(),
  }),
  z.object({ type: z.literal("press"), key: z.string() }),
  z.object({
    type: z.literal("read"),
    target: TargetDescriptor,
    into: z.string(),
  }),
  z.object({
    type: z.literal("wait_for"),
    assertion: Assertion,
    timeoutMs: z.number().int().positive().default(10_000),
  }),
]);
export type Action = z.infer<typeof Action>;

/**
 * The three-way split the brief calls out as the most common design mistake.
 *
 *   business_outcome - a legitimate answer the caller needs ("no such member").
 *                      Returns cleanly with a code. NOT an error.
 *   recover          - a known runtime condition we can handle ourselves
 *                      (dismiss an interstitial, wait out a slow load, re-auth).
 *   escalate         - we cannot proceed safely, but a human could.
 *   fail             - stop and surface a debuggable error.
 */
export const OutcomeDisposition = z.enum([
  "business_outcome",
  "recover",
  "escalate",
  "fail",
]);

export const RecoveryAction = z.discriminatedUnion("do", [
  z.object({
    do: z.literal("dismiss"),
    target: TargetDescriptor,
    describedAs: z.string(),
  }),
  z.object({
    do: z.literal("wait_retry"),
    delayMs: z.number().int().positive().default(1000),
  }),
  z.object({ do: z.literal("reauthenticate") }),
]);

/** "If this assertion holds after the step, treat the run this way." */
export const OutcomeRule = z.object({
  /** Stable machine code the caller switches on, e.g. MEMBER_NOT_FOUND. */
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  describedAs: z.string(),
  detector: Assertion,
  disposition: OutcomeDisposition,
  recovery: RecoveryAction.optional(),
  /** Bounded so a recoverable condition can never become an infinite loop. */
  maxAttempts: z.number().int().positive().default(2),
});
export type OutcomeRule = z.infer<typeof OutcomeRule>;

export const Step = z.object({
  id: z.string(),
  /** Natural language, from the discovery run. This is what makes the artifact reviewable. */
  intent: z.string(),
  action: Action,
  riskClass: RiskClass.default("safe"),
  /** Verified after the action. A step with no checkpoint is a step that assumed its click worked. */
  checkpoint: Checkpoint.optional(),
  /** Step-scoped rules, evaluated before the checkpoint is judged to have failed. */
  outcomes: z.array(OutcomeRule).default([]),
  /**
   * Something the recorder could not resolve and a human must look at.
   *
   * Not an error: the step was recorded and is replayable. It is a reason the
   * draft should not be approved without someone reading this step, and the
   * console surfaces it as an anomaly during review.
   */
  reviewNote: z.string().optional(),
});
export type Step = z.infer<typeof Step>;

/**
 * A Capability: the reusable unit an AI agent invokes in production.
 *
 * Shaped as a *contract* rather than a step list. Inputs, outputs, outcomes and
 * the success condition are all declared at the top level, so a calling agent
 * (or a human reviewer) can understand what it does, what it needs and what it
 * returns without reading a single step.
 */
export const Capability = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9_.]*$/,
      "stable, human-readable id e.g. cu.member.read_savings_balance",
    ),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  title: z.string(),
  description: z
    .string()
    .describe("What a calling agent needs to know to decide to invoke this."),

  /**
   * Approval gate. A draft capability may only be replayed attended.
   * Unattended invocation requires `approved`, which a human sets after review.
   */
  status: z.enum(["draft", "approved", "deprecated"]).default("draft"),

  surface: z.object({
    kind: z.enum(["web", "desktop"]).default("web"),
    entryPoint: z.string(),
    /**
     * Which vendor product and version this was recorded against. This is the
     * hook for multi-tenant reuse: hundreds of institutions run the same product,
     * so the capability belongs to the *product*, not to the tenant.
     */
    appProfile: z.object({
      vendorApp: z.string(),
      versionRange: z.string().default("*"),
    }),
  }),

  /** "base" means tenant-agnostic. A tenant id means this is a specialization. */
  tenant: z.string().default("base"),

  /**
   * Per-tenant specialisation of a base capability.
   *
   * Hundreds of institutions run the same vendor product, so a capability
   * belongs to the *product*, not to the tenant. Nearly all of the variation
   * between two installs is absorbed by the ranked strategy list already: a
   * descriptor that lists "Member ID" first and "Member Number" second resolves
   * on both. What is left over lives here.
   *
   * Deliberately narrow. An override can point the flow at a different host and
   * add label aliases. It cannot change the steps, the outcome table or the
   * policy — if a tenant needs different *behaviour*, that is a fork worth
   * reviewing, not a config value, and it gets its own artifact with
   * `tenant: "<id>"`.
   */
  tenantOverrides: z
    .record(
      z.string(),
      z.object({
        entryPoint: z.string().optional(),
        /** Extra label aliases, keyed by the target's `describedAs`. */
        aliases: z.record(z.string(), z.array(z.string())).default({}),
        note: z.string().optional(),
      }),
    )
    .default({}),

  inputs: z.array(ParamSpec).default([]),
  outputs: z.array(OutputSpec).default([]),
  steps: z.array(Step).min(1),

  /** Asserted at the end. If this does not hold, the run did not succeed, whatever the steps reported. */
  successCondition: Checkpoint,

  /** Capability-wide rules, evaluated after every step. Session timeout belongs here, not on one step. */
  outcomes: z.array(OutcomeRule).default([]),

  policy: z.object({
    allowedOrigins: z.array(z.string()).min(1),
    allowedActions: z
      .array(z.string())
      .default([
        "navigate",
        "click",
        "type",
        "select",
        "press",
        "read",
        "wait_for",
      ]),
    /** Steps at or above this risk class require a human decision even on an approved capability. */
    confirmAtOrAbove: RiskClass.default("irreversible"),
  }),

  provenance: z.object({
    discoveredBy: z.object({ provider: z.string(), model: z.string() }),
    runId: z.string(),
    createdAt: z.string(),
    /**
     * Hash only. The raw model transcript is evidence, not part of the capability:
     * it is large, contains screen text that may include PII, and coupling the
     * contract to it would make the artifact unreviewable.
     */
    transcriptSha256: z.string(),
    /** Set when a human corrected or completed the run during discovery. */
    humanAssisted: z.boolean().default(false),
  }),
});
export type Capability = z.infer<typeof Capability>;

/**
 * Apply a tenant override to a base capability.
 *
 * Returns a new capability; the base is never mutated, so one loaded artifact
 * can serve every tenant in the same process. Aliases are *added* to the
 * existing ranked strategies rather than replacing them, so the base labels
 * stay as the higher-confidence first choice and the tenant's wording is a
 * recorded fallback — which means the run log shows plainly when a tenant
 * needed its own alias to resolve a control.
 */
export function specializeForTenant(
  cap: Capability,
  tenantId: string,
): Capability {
  const ov = cap.tenantOverrides[tenantId];
  if (!ov) return cap;

  const withAliases = (
    t: TargetDescriptor | undefined,
  ): TargetDescriptor | undefined => {
    if (!t) return t;
    const extra = ov.aliases[t.describedAs];
    if (!extra?.length) return t;
    return {
      ...t,
      strategies: [
        ...t.strategies,
        ...extra.map((label) => ({
          strategy:
            t.strategies[0]?.strategy.kind === "role_name"
              ? {
                  kind: "role_name" as const,
                  role: (t.strategies[0].strategy as { role: string }).role,
                  name: label,
                  nameMatch: "normalized" as const,
                  aliases: [],
                }
              : {
                  kind: "label_proximity" as const,
                  labelText: label,
                  labelMatch: "normalized" as const,
                  relation: "right_of" as const,
                  controlRole: "textbox",
                },
          confidence: 0.6,
          rationale: `tenant "${tenantId}" override: this install labels it "${label}"`,
        })),
      ],
    };
  };

  return {
    ...cap,
    tenant: tenantId,
    surface: {
      ...cap.surface,
      entryPoint: ov.entryPoint ?? cap.surface.entryPoint,
    },
    steps: cap.steps.map((st) => ({
      ...st,
      action:
        "target" in st.action && st.action.target
          ? { ...st.action, target: withAliases(st.action.target)! }
          : st.action,
    })),
    outputs: cap.outputs.map((o) => ({ ...o, source: withAliases(o.source)! })),
  };
}
