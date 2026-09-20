import type { Action, Capability, RiskClass } from "./artifact.js";

/**
 * Policy enforcement.
 *
 * Checked before *every* action, not once at planning time. A plan approved up
 * front is not a guarantee about what the next action will be - during discovery
 * the model chooses each action freshly, and during replay a page can redirect
 * somewhere unexpected between one step and the next.
 *
 * Two layers, and both matter:
 *
 *   - This engine gates the actions the system chooses to take.
 *   - The web surface adapter additionally installs a network-level route filter
 *     from the same allowlist, so even a page-initiated redirect cannot carry the
 *     session somewhere off-list. This engine supplies the predicate; see
 *     src/surface/web.ts for the enforcement.
 *
 * The asymmetry between discovery and replay is the important design decision.
 * During discovery a risky action pauses for a human, because a model chose it
 * and nobody has reviewed it. During replay no *new* risky action can appear:
 * replay executes only steps recorded and approved earlier, so the risk surface
 * was fixed and reviewed before it was ever allowed to run unattended.
 */

const RISK_ORDER: Record<RiskClass, number> = {
  safe: 0,
  risky: 1,
  irreversible: 2,
};

export type PolicyMode =
  /** LLM is choosing actions. Risky actions require a human decision. */
  | "discovery"
  /** Replaying a recorded capability with a human watching. Draft is acceptable. */
  | "replay_attended"
  /** Replaying unattended, as a production agent would. Requires an approved capability. */
  | "replay_unattended";

export type VerdictCode =
  | "ORIGIN_NOT_ALLOWED"
  | "ACTION_NOT_ALLOWED"
  | "RISK_REQUIRES_CONFIRMATION"
  | "NOT_APPROVED"
  | "MALFORMED_URL";

export type PolicyVerdict =
  | { decision: "allow" }
  /** Permitted, but a human must say yes first. Routed through the escalation path. */
  | { decision: "confirm"; code: VerdictCode; reason: string }
  | { decision: "deny"; code: VerdictCode; reason: string };

/**
 * Match a URL against one allowlist entry.
 *
 * An entry with no path ("http://host:8080") permits the whole origin. An entry
 * ending in "/*" permits that path prefix. Anything else must match the path
 * exactly. Deliberately not a regex language: allowlists are security-relevant
 * and a reviewer must be able to read one at a glance without evaluating a
 * pattern in their head.
 */
export function urlMatchesEntry(url: string, entry: string): boolean {
  let u: URL;
  let e: URL;
  try {
    u = new URL(url);
    e = new URL(entry.endsWith("/*") ? entry.slice(0, -2) || "/" : entry);
  } catch {
    return false;
  }
  if (u.origin !== e.origin) return false;
  if (entry.endsWith("/*")) {
    const prefix = e.pathname === "/" ? "/" : e.pathname;
    return (
      u.pathname === prefix ||
      u.pathname.startsWith(prefix.endsWith("/") ? prefix : prefix + "/")
    );
  }
  // Entry with no explicit path permits the entire origin.
  if (e.pathname === "/" && !entry.replace(e.origin, "").replace(/\/$/, ""))
    return true;
  return u.pathname === e.pathname;
}

export class PolicyEngine {
  constructor(
    private readonly policy: Capability["policy"],
    private readonly mode: PolicyMode,
    private readonly status: Capability["status"] = "draft",
  ) {}

  /** Gate on approval state. Called once before a replay starts. */
  checkApproval(): PolicyVerdict {
    if (this.mode === "replay_unattended" && this.status !== "approved") {
      return {
        decision: "deny",
        code: "NOT_APPROVED",
        reason: `capability status is "${this.status}"; unattended replay requires "approved"`,
      };
    }
    if (this.status === "deprecated") {
      return {
        decision: "deny",
        code: "NOT_APPROVED",
        reason: "capability is deprecated",
      };
    }
    return { decision: "allow" };
  }

  isOriginAllowed(url: string): boolean {
    return this.policy.allowedOrigins.some((e) => urlMatchesEntry(url, e));
  }

  /** The per-action gate. Every action passes through here before it runs. */
  check(
    action: Action,
    riskClass: RiskClass,
    currentUrl?: string,
  ): PolicyVerdict {
    if (!this.policy.allowedActions.includes(action.type)) {
      return {
        decision: "deny",
        code: "ACTION_NOT_ALLOWED",
        reason: `action type "${action.type}" is not in the capability allowlist`,
      };
    }

    // Navigation is checked against its destination; everything else against
    // where we currently are, so a drifted session cannot keep acting.
    const target = action.type === "navigate" ? action.url : currentUrl;
    if (target !== undefined) {
      if (!/^https?:\/\//i.test(target)) {
        return {
          decision: "deny",
          code: "MALFORMED_URL",
          reason: `not an http(s) URL: ${target}`,
        };
      }
      if (!this.isOriginAllowed(target)) {
        return {
          decision: "deny",
          code: "ORIGIN_NOT_ALLOWED",
          reason: `${target} is outside the allowlist [${this.policy.allowedOrigins.join(", ")}]`,
        };
      }
    }

    if (RISK_ORDER[riskClass] >= RISK_ORDER[this.policy.confirmAtOrAbove]) {
      // Unattended replay cannot ask anyone, so it stops and escalates instead
      // of proceeding on its own judgement.
      return {
        decision: "confirm",
        code: "RISK_REQUIRES_CONFIRMATION",
        reason: `step is classified "${riskClass}"; policy requires confirmation at or above "${this.policy.confirmAtOrAbove}"`,
      };
    }

    return { decision: "allow" };
  }
}

/**
 * Conservative risk classification from an action and the text around it.
 *
 * Shared by the recorder (classifying a step as it is recorded) and the
 * discovery loop (gating an action the model just proposed), so the two cannot
 * drift — a flow recorded as `irreversible` must be one discovery would also
 * have stopped on.
 *
 * They feed it different text on purpose. The gate passes only the control's
 * label, because that is what a human would read before clicking and because a
 * model explaining a benign click as "submit the search" must not be blocked
 * for the word. The recorder also passes the step intent, since its output is a
 * suggestion a reviewer sees rather than a decision that halts a run.
 *
 * Deliberately pessimistic: a false "risky" costs one human confirmation, a
 * false "safe" costs an irreversible action nobody approved. It is a heuristic
 * and is meant to prompt review, not replace it.
 */
/** Operations that cannot be taken back once they complete. */
const IRREVERSIBLE =
  /\b(transfer|withdraw|delete|remove|post|posting|close account|wire|disburse)\b/;
/** Controls that commit whatever screen they are on. */
const COMMITTING =
  /\b(submit|confirm|save|create|open|add|apply|update|approve)\b/;

/**
 * How dangerous is this action?
 *
 * `context` is the surrounding screen - its heading and visible text - and it
 * is not optional in spirit even though it is in the signature.
 *
 * Judging by the control's own label alone gets the important case exactly
 * backwards, which is how it was first written and how it shipped. A link
 * reading "Post Adjustment" matched "post" and was gated as irreversible, but
 * that link only opens a form; nothing has happened yet. The button that
 * actually moves the money reads "Confirm", matched only the committing list,
 * and was waved through as merely risky. The gate was guarding the doorway and
 * ignoring the transaction.
 *
 * So a committing control inherits the consequence of the screen it commits.
 */
export function classifyActionRisk(
  kind: string,
  text: string,
  context = "",
): RiskClass {
  if (kind !== "click") return "safe";
  const t = text.toLowerCase();
  if (IRREVERSIBLE.test(t)) return "irreversible";
  if (COMMITTING.test(t)) {
    return IRREVERSIBLE.test(context.toLowerCase()) ? "irreversible" : "risky";
  }
  return "safe";
}

/** Default policy for a freshly discovered capability: least privilege. */
export function defaultPolicy(entryPoint: string): Capability["policy"] {
  const origin = (() => {
    try {
      return new URL(entryPoint).origin;
    } catch {
      return entryPoint;
    }
  })();
  return {
    allowedOrigins: [origin],
    allowedActions: [
      "navigate",
      "click",
      "type",
      "select",
      "press",
      "read",
      "wait_for",
    ],
    confirmAtOrAbove: "irreversible",
  };
}
