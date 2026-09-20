import { createHash } from "node:crypto";
import type {
  Capability,
  Step,
  ParamSpec,
  OutputSpec,
} from "../core/artifact.js";
import {
  SCHEMA_VERSION,
  Capability as CapabilitySchema,
} from "../core/artifact.js";
import type { TargetDescriptor, RankedStrategy } from "../core/targeting.js";
import type { Observation, SurfaceNode } from "../surface/types.js";
import { defaultPolicy } from "../core/policy.js";

/**
 * The recorder: turns a successful discovery run into a reusable capability.
 *
 * This is the hinge of the whole system. During discovery the agent acts on
 * `ref_7`, which is meaningless five seconds later - refs are ephemeral and
 * deliberately never persisted. The recorder's job is to convert each ref into a
 * *durable description* of the same control, so replay can find it again next
 * month without a model.
 *
 * Strategies are ranked by how much the surface actually told us, not by a fixed
 * preference order:
 *
 *   - a real accessible name is the most trustworthy thing a platform can give
 *     us, and it is the one signal that transfers to UIA and AX on the desktop
 *   - an adjacent label is less certain but is frequently the *only* option on
 *     legacy markup, where controls have no name at all
 *   - positional matching is a last resort, recorded so that replay degrades
 *     rather than failing outright, and logged loudly when it is reached
 *
 * Structural selectors (CSS/XPath) are supported by the schema but deliberately
 * not emitted here. They encode incidental document structure, and recording one
 * would give a false sense of robustness on exactly the surfaces where the
 * structure is least meaningful.
 */

/** One thing the agent did, captured at the moment it did it. */
export type RecordedAction = {
  stepId: string;
  intent: string;
  kind: "click" | "type" | "select" | "press" | "navigate" | "read";
  /** The node acted on, as perceived at the time. */
  node?: SurfaceNode;
  /** Raw value typed, before templating. */
  value?: string;
  url?: string;
  key?: string;
  /** For `read`: the name the value was captured under. */
  into?: string;
  /** Observation *after* the action, used to derive a checkpoint. */
  after: Observation;
  /** Observation before, used to work out what actually changed. */
  before: Observation;
};

/** Build a durable descriptor for a control the agent acted on. */
export function describeTarget(
  node: SurfaceNode,
  describedAs: string,
): TargetDescriptor {
  const strategies: RankedStrategy[] = [];

  if (node.name) {
    strategies.push({
      strategy: {
        kind: "role_name",
        role: node.role,
        name: node.name,
        nameMatch: "normalized",
        aliases: [],
        ...(node.container ? { scope: node.container } : {}),
      },
      confidence: node.container ? 0.95 : 0.9,
      rationale: node.container
        ? `control has a real accessible name, scoped to the ${node.container.role} "${node.container.name}"`
        : "control has a real accessible name",
    });
  }

  if (node.adjacentLabel) {
    strategies.push({
      strategy: {
        kind: "label_proximity",
        labelText: node.adjacentLabel,
        labelMatch: "normalized",
        relation: node.adjacentRelation ?? "after",
        controlRole: node.role,
      },
      // When the platform gave us no name this is not a fallback, it is the only
      // way to address the control at all.
      confidence: node.name ? 0.75 : 0.9,
      rationale: node.name
        ? `secondary: the ${node.adjacentRelation ?? "adjacent"} label reads "${node.adjacentLabel}"`
        : `control has no accessible name; its visible label is the ${node.adjacentRelation ?? "adjacent"} text "${node.adjacentLabel}"`,
    });
  }

  strategies.push({
    strategy: {
      kind: "nth_of_role",
      role: node.role,
      index: 0,
      ...(node.container ? { scope: node.container } : {}),
    },
    confidence: 0.25,
    rationale:
      "positional last resort; replay logs loudly when it reaches this",
  });

  return {
    describedAs,
    framePath: node.framePath,
    strategies,
    ...(node.bbox ? { boundingBoxHint: node.bbox } : {}),
    ambiguityPolicy: "fail",
  };
}

/**
 * Derive a checkpoint from what actually changed on screen.
 *
 * Preferring text that appeared *and was not there before* is the point: an
 * assertion on text that was already present verifies nothing, and a step whose
 * checkpoint always passes is worse than no checkpoint, because it looks like
 * verification.
 */
export function deriveCheckpoint(
  before: Observation,
  after: Observation,
  intent: string,
  /**
   * Values that must never end up inside a checkpoint. Two different reasons,
   * both discovered the hard way when a recorded run asserted on the literal
   * username it had just typed:
   *
   *   - a secret in an artifact is a secret in source control
   *   - a run-specific value makes the checkpoint pass only for that one input,
   *     which quietly turns a reusable capability into a single-use script
   *
   * The second is the subtler failure: nothing errors, the capability just stops
   * generalising, and the first person to call it with a different member ID
   * gets an inexplicable CHECKPOINT_FAILED.
   */
  forbidden: string[] = [],
) {
  const taboo = forbidden.filter((v) => v && v.length >= 3);
  const containsForbidden = (line: string) =>
    taboo.some((v) => line.includes(v));

  const beforeLines = new Set(
    before.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean),
  );
  const appeared = after.text
    .split("\n")
    .map((l) => l.trim())
    .filter(
      (l) =>
        l.length >= 4 &&
        l.length <= 60 &&
        !beforeLines.has(l) &&
        !containsForbidden(l) &&
        // A field full of password bullets "appears" too. Asserting on it
        // verifies nothing, which is worse than having no checkpoint at all
        // because it looks like verification.
        /[a-z0-9]/i.test(l),
    );

  const all: Capability["successCondition"]["all"] = [];
  const marker = appeared.find((l) => !/^\$|^\d/.test(l)) ?? appeared[0];
  if (marker)
    all.push({ kind: "text_present", text: marker, match: "normalized" });

  const beforeUrls = new Set(before.frames.map((f) => f.url));
  const movedTo = after.frames.find((f) => !beforeUrls.has(f.url));
  if (movedTo) {
    const path = new URL(movedTo.url).pathname.replace(
      /\/\d+(?=\/|$)/g,
      "/\\d+",
    );
    all.push({
      kind: "url_matches",
      pattern: path.replace(/[.*+?^${}()|[\]\\]/g, (m) =>
        m === "\\" ? m : "\\" + m,
      ),
    });
  }

  return all.length
    ? {
        describedAs: `the screen reached the state expected after: ${intent}`,
        timeoutMs: 10_000,
        all,
      }
    : undefined;
}

export type RecordOptions = {
  id: string;
  title: string;
  description: string;
  goal: string;
  entryPoint: string;
  vendorApp: string;
  tenant?: string;
  /** Values the operator supplied for this run, which become typed parameters. */
  parameters: Record<string, { value: string; spec: Omit<ParamSpec, "name"> }>;
  /** Secret keys used, so their literal values never reach the artifact. */
  secretValues: Record<string, string>;
  actions: RecordedAction[];
  finalObservation: Observation;
  outputs: {
    name: string;
    description: string;
    node: SurfaceNode;
    type: OutputSpec["type"];
    sensitivity: OutputSpec["sensitivity"];
  }[];
  provenance: {
    provider: string;
    model: string;
    runId: string;
    transcript: string;
  };
};

export function recordCapability(opts: RecordOptions): Capability {
  const paramByValue = new Map(
    Object.entries(opts.parameters).map(([name, p]) => [p.value, name]),
  );
  const secretByValue = new Map(
    Object.entries(opts.secretValues).map(([key, v]) => [v, key]),
  );

  /** Replace concrete values with templates so the flow generalises. */
  const templatize = (raw: string): string => {
    const secret = secretByValue.get(raw);
    if (secret) return `{{secret:${secret}}}`;
    const param = paramByValue.get(raw);
    if (param) return `{{${param}}}`;
    return raw;
  };

  /** Secrets and per-run parameter values are both unfit to appear in a checkpoint. */
  const forbiddenInCheckpoints = [
    ...Object.values(opts.secretValues),
    ...Object.values(opts.parameters).map((p) => p.value),
  ];

  const steps: Step[] = opts.actions
    .filter((a) => a.kind !== "read")
    .map((a) => {
      const checkpoint = deriveCheckpoint(
        a.before,
        a.after,
        a.intent,
        forbiddenInCheckpoints,
      );
      const base = {
        id: a.stepId,
        intent: a.intent,
        riskClass: classifyRisk(a),
        outcomes: [],
        ...(checkpoint ? { checkpoint } : {}),
      };

      switch (a.kind) {
        case "navigate":
          return {
            ...base,
            action: { type: "navigate" as const, url: templatize(a.url ?? "") },
          };
        case "press":
          return {
            ...base,
            action: { type: "press" as const, key: a.key ?? "Enter" },
          };
        case "type":
          return {
            ...base,
            action: {
              type: "type" as const,
              target: describeTarget(a.node!, a.intent),
              value: templatize(a.value ?? ""),
              clearFirst: true,
            },
          };
        case "select":
          return {
            ...base,
            action: {
              type: "select" as const,
              target: describeTarget(a.node!, a.intent),
              value: templatize(a.value ?? ""),
            },
          };
        default:
          return {
            ...base,
            action: {
              type: "click" as const,
              target: describeTarget(a.node!, a.intent),
            },
          };
      }
    });

  const inputs: ParamSpec[] = Object.entries(opts.parameters).map(
    ([name, p]) => ({ name, ...p.spec }),
  );

  const outputs: OutputSpec[] = opts.outputs.map((o) => ({
    name: o.name,
    type: o.type,
    description: o.description,
    sensitivity: o.sensitivity,
    source: describeTarget(o.node, `the ${o.name} value`),
    transform:
      o.type === "number"
        ? [
            { op: "trim" as const },
            { op: "strip" as const, chars: "$," },
            { op: "to_number" as const },
          ]
        : [{ op: "trim" as const }],
  }));

  /**
   * Derived against the FIRST observation, not the last step's.
   *
   * Diffing the final screen against the one immediately before it finds
   * whatever changed in the last click - often nothing, which yields an empty
   * condition. An empty success condition is the worst possible outcome here:
   * `waitForCheckpoint` trivially satisfies it, so every replay reports success
   * without verifying anything at all.
   *
   * Diffing against the start of the run instead asks the right question - what
   * is true at the end that was not true when we began - and that is what
   * "reached the goal" actually means.
   */
  const first = opts.actions[0];
  const successCondition =
    (first &&
      deriveCheckpoint(
        first.before,
        opts.finalObservation,
        `achieve the goal: ${opts.goal}`,
        forbiddenInCheckpoints,
      )) ??
    undefined;

  if (!successCondition || successCondition.all.length === 0) {
    throw new Error(
      "could not derive a success condition from this run: nothing distinguishable changed between the first and final screens. " +
        "Refusing to emit a capability that would report success without verifying anything.",
    );
  }

  return CapabilitySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: opts.id,
    version: "1.0.0",
    title: opts.title,
    description: opts.description,
    /**
     * Always draft.
     *
     * A single successful discovery run proves the happy path works. It cannot
     * know what the *error* states look like, because it never saw one - the
     * outcome table is authored during human review, which is precisely what the
     * draft -> approved gate is for. Emitting `approved` here would claim
     * knowledge the run does not have.
     */
    status: "draft",
    surface: {
      kind: "web",
      entryPoint: opts.entryPoint,
      appProfile: { vendorApp: opts.vendorApp, versionRange: "*" },
    },
    tenant: opts.tenant ?? "base",
    inputs,
    outputs,
    steps,
    successCondition,
    outcomes: [],
    policy: defaultPolicy(opts.entryPoint),
    provenance: {
      discoveredBy: {
        provider: opts.provenance.provider,
        model: opts.provenance.model,
      },
      runId: opts.provenance.runId,
      createdAt: new Date().toISOString(),
      // Hash only. The transcript is evidence, lives in /evidence/, and is not
      // part of the contract - it is large and full of unredacted screen text.
      transcriptSha256: createHash("sha256")
        .update(opts.provenance.transcript)
        .digest("hex"),
      humanAssisted: false,
    },
  });
}

/**
 * Conservative risk classification at record time.
 *
 * Heuristic and deliberately pessimistic: a false "risky" costs one human
 * confirmation, a false "safe" costs an irreversible action nobody approved.
 * A human adjusts these during review, before the capability is ever approved.
 */
function classifyRisk(a: RecordedAction): Step["riskClass"] {
  if (a.kind !== "click") return "safe";
  const label = `${a.node?.label ?? ""} ${a.intent}`.toLowerCase();
  if (
    /\b(transfer|withdraw|delete|remove|post|close account|wire)\b/.test(label)
  )
    return "irreversible";
  if (/\b(submit|confirm|save|create|open|add|apply|update)\b/.test(label))
    return "risky";
  return "safe";
}
