import { describe, it, expect } from "vitest";
import {
  isSignInStep,
  toCode,
  DISPOSITIONS,
} from "../web/src/console/CapabilityEditor.tsx";
import type { CapabilityDoc } from "../web/src/console/lib/api.ts";

const doc = (
  steps: { id: string; type: string; value?: string }[],
): CapabilityDoc =>
  ({
    steps: steps.map((s) => ({
      id: s.id,
      intent: s.id,
      riskClass: "safe",
      action: {
        type: s.type,
        ...(s.value !== undefined ? { value: s.value } : {}),
      },
      outcomes: [],
    })),
  }) as unknown as CapabilityDoc;

describe("isSignInStep", () => {
  const flow = doc([
    { id: "s1", type: "type", value: "{{secret:corelink.username}}" },
    { id: "s2", type: "type", value: "{{secret:corelink.password}}" },
    { id: "s3", type: "click" },
    { id: "s4", type: "type", value: "{{memberId}}" },
    { id: "s5", type: "click" },
  ]);

  it("treats typing a credential as sign-in", () => {
    expect(isSignInStep(flow, 0)).toBe(true);
    expect(isSignInStep(flow, 1)).toBe(true);
  });

  // The submit right after the last credential belongs to signing in too.
  it("treats the submit after the last credential as sign-in", () => {
    expect(isSignInStep(flow, 2)).toBe(true);
  });

  it("leaves the actual work visible", () => {
    expect(isSignInStep(flow, 3)).toBe(false);
    expect(isSignInStep(flow, 4)).toBe(false);
  });

  it("hides nothing in a flow with no credentials", () => {
    const noAuth = doc([
      { id: "s1", type: "type", value: "{{memberId}}" },
      { id: "s2", type: "click" },
    ]);
    expect([0, 1].map((i) => isSignInStep(noAuth, i))).toEqual([false, false]);
  });

  it("does not mistake a later click for the sign-in submit", () => {
    const flow2 = doc([
      { id: "s1", type: "type", value: "{{secret:k}}" },
      { id: "s2", type: "click" },
      { id: "s3", type: "click" },
    ]);
    expect(isSignInStep(flow2, 1)).toBe(true);
    expect(isSignInStep(flow2, 2)).toBe(false);
  });

  it("is safe on an out-of-range index", () => {
    expect(isSignInStep(flow, 99)).toBe(false);
  });
});

describe("toCode", () => {
  it("turns a plain description into the code the contract uses", () => {
    expect(toCode("no member exists with that ID")).toBe(
      "NO_MEMBER_EXISTS_WITH_THAT_ID",
    );
  });

  it("collapses punctuation and trims separators", () => {
    expect(toCode("  permission denied — restricted!  ")).toBe(
      "PERMISSION_DENIED_RESTRICTED",
    );
  });

  it("produces an empty code from empty input, rather than junk", () => {
    expect(toCode("   ")).toBe("");
  });
});

describe("DISPOSITIONS", () => {
  /**
   * These are the operator-facing wording for the result contract. If a
   * disposition is ever added to the schema without appearing here, a reviewer
   * silently cannot select it.
   */
  it("covers every disposition the schema allows", () => {
    expect(DISPOSITIONS.map((d) => d.value).sort()).toEqual(
      ["business_outcome", "escalate", "fail", "recover"].sort(),
    );
  });

  it("describes each one without jargon", () => {
    for (const d of DISPOSITIONS) {
      expect(d.label).not.toMatch(/_/);
      expect(d.hint.length).toBeGreaterThan(10);
    }
  });
});
