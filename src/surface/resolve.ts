import type {
  FrameStep,
  LocatorStrategy,
  TargetDescriptor,
  ContainerRef,
} from "../core/targeting.js";
import {
  normalizeName,
  type Observation,
  type Resolution,
  type SurfaceNode,
} from "./types.js";

/**
 * Locator resolution: recorded descriptor -> exactly one concrete node.
 *
 * Pure, and takes an Observation rather than a browser, so the entire
 * determinism story is unit-testable without launching anything. That matters
 * because this is where replay is won or lost.
 *
 * Two rules drive everything:
 *
 *   1. Strategies are tried in recorded order and the first one that resolves
 *      *unambiguously* wins. Later strategies are lower-trust fallbacks, so
 *      reaching them is worth logging.
 *
 *   2. Ambiguity is a failure, not a tie to be broken. If a strategy matches two
 *      nodes, resolution stops and says so. Taking the first match is how an
 *      automation quietly clicks the wrong control, and in a back-office banking
 *      context a confident wrong action is far worse than a clean halt.
 */

/** Resolver for structural strategies (css/xpath), which need a live DOM. */
export type StructuralResolver = (
  strategy: LocatorStrategy,
) => SurfaceNode[] | null;

export function resolveTarget(
  target: TargetDescriptor,
  observation: Observation,
  structural?: StructuralResolver,
): Resolution {
  const tried: LocatorStrategy[] = [];
  const inFrame = observation.nodes.filter((n) =>
    framePathMatches(target.framePath, n.framePath),
  );

  for (let i = 0; i < target.strategies.length; i++) {
    const ranked = target.strategies[i]!;
    const s = ranked.strategy;
    tried.push(s);

    let matches: SurfaceNode[];
    if (s.kind === "css" || s.kind === "xpath") {
      const r = structural?.(s);
      if (r === null || r === undefined) continue; // no live DOM available here
      matches = r;
    } else {
      matches = matchSemantic(s, inFrame);
    }

    if (matches.length === 1) {
      return {
        ok: true,
        node: matches[0]!,
        strategyIndex: i,
        strategy: s,
        confidence: ranked.confidence,
      };
    }
    if (matches.length > 1) {
      if (target.ambiguityPolicy === "fail") {
        return {
          ok: false,
          reason: "ambiguous",
          strategy: s,
          candidates: matches.slice(0, 5),
        };
      }
      return {
        ok: true,
        node: matches[0]!,
        strategyIndex: i,
        strategy: s,
        confidence: ranked.confidence * 0.5,
      };
    }
  }

  return { ok: false, reason: "not_found", tried };
}

function matchSemantic(
  s: LocatorStrategy,
  nodes: SurfaceNode[],
): SurfaceNode[] {
  switch (s.kind) {
    case "role_name": {
      const wanted = [s.name, ...(s.nameMatch === "alias" ? s.aliases : [])];
      return nodes.filter(
        (n) =>
          roleEq(n.role, s.role) &&
          nameMatches(n.label, wanted, s.nameMatch) &&
          scopeMatches(n.container, s.scope),
      );
    }

    case "label_proximity": {
      /**
       * Matches on the *neighbouring* label, not the node's own name.
       *
       * These are different facts. An unlabelled <input> has no name, so its
       * adjacent text becomes its label and the two coincide. A value cell
       * reading "$8,214.55" already has a perfectly good name of its own - the
       * only way to address it is "the cell beside the one saying Savings
       * Balance". Matching the node's own name finds the label cell, or nothing.
       *
       * The recorded relation is enforced rather than decorative. On a
       * two-column layout the cell to the RIGHT of "Name:" and the cell BELOW
       * it both report the same adjacent text, so without direction the
       * descriptor is ambiguous and replay correctly refuses to act.
       */
      const allowedSources =
        s.relation === "wraps"
          ? ["associated_label"]
          : ["adjacent_text", "associated_label"];

      return nodes.filter((n) => {
        if (!roleEq(n.role, s.controlRole)) return false;

        // "after" is a deliberate wildcard for a recorder that could not
        // determine a direction; anything else must agree.
        const relationOk =
          s.relation === "after" ||
          n.adjacentRelation === undefined ||
          n.adjacentRelation === s.relation;

        const viaAdjacent =
          relationOk &&
          n.adjacentLabel !== undefined &&
          nameMatches(n.adjacentLabel, [s.labelText], s.labelMatch);

        // Fallback for a control whose inferred label *is* the adjacent text.
        const viaOwnLabel =
          allowedSources.includes(n.labelSource) &&
          nameMatches(n.label, [s.labelText], s.labelMatch);

        return viaAdjacent || viaOwnLabel;
      });
    }

    case "nth_of_role": {
      const pool = nodes.filter(
        (n) => roleEq(n.role, s.role) && scopeMatches(n.container, s.scope),
      );
      const hit = pool[s.index];
      return hit ? [hit] : [];
    }

    default:
      return [];
  }
}

const roleEq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function nameMatches(
  actual: string,
  wanted: string[],
  mode: "exact" | "normalized" | "alias",
): boolean {
  if (mode === "exact") return wanted.some((w) => w === actual);
  const a = normalizeName(actual);
  return wanted.some((w) => normalizeName(w) === a);
}

function scopeMatches(
  container: ContainerRef | undefined,
  scope: ContainerRef | undefined,
): boolean {
  if (!scope) return true;
  if (!container) return false;
  if (!roleEq(container.role, scope.role)) return false;
  if (!scope.name) return true;
  return normalizeName(container.name ?? "") === normalizeName(scope.name);
}

/**
 * Frame matching is tolerant by design. A recorded frame carries a name, a URL
 * pattern and an index; hosts and paths differ between tenants, so a name match
 * is authoritative and the others are fallbacks. Requiring all three to agree
 * would make every artifact tenant-specific for no safety gain.
 */
export function framePathMatches(
  recorded: FrameStep[],
  actual: FrameStep[],
): boolean {
  if (recorded.length === 0) return true; // descriptor did not care which frame
  if (recorded.length !== actual.length) return false;
  return recorded.every((r, i) => {
    const a = actual[i]!;
    if (r.name) return r.name === a.name;
    if (r.urlPattern) return r.urlPattern === a.urlPattern;
    if (r.index !== undefined) return r.index === a.index;
    return true;
  });
}
