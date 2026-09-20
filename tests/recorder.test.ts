import { describe, it, expect } from "vitest";
import { classifyActionRisk } from "../src/core/policy.js";
import { describeTarget, deriveCheckpoint } from "../src/agent/recorder.js";
import type { Observation, SurfaceNode } from "../src/surface/types.js";

const node = (
  o: Partial<SurfaceNode> & { ref: string; role: string; label: string },
): SurfaceNode => ({
  name: o.label,
  labelSource: "accessible_name",
  framePath: [],
  ...o,
});

const obs = (
  text: string,
  frames: { name: string; url: string }[] = [],
): Observation => ({
  url: "http://app/",
  title: "t",
  frames: frames.map((f, i) => ({
    id: String(i),
    name: f.name,
    url: f.url,
    depth: i,
  })),
  nodes: [],
  text,
  capturedAt: "",
});

describe("classifyActionRisk", () => {
  it("treats non-clicks as safe: typing and key presses change nothing on their own", () => {
    expect(classifyActionRisk("type", "Confirm transfer")).toBe("safe");
    expect(classifyActionRisk("press", "Enter")).toBe("safe");
  });

  it("flags irreversible money movement", () => {
    for (const label of [
      "Transfer Funds",
      "Withdraw",
      "Wire",
      "Close Account",
      "Delete Member",
    ]) {
      expect(classifyActionRisk("click", label)).toBe("irreversible");
    }
  });

  it("flags state-changing but correctable actions as risky", () => {
    for (const label of [
      "Submit",
      "Confirm",
      "Save Settings",
      "Create Sub-Account",
      "Approve",
    ]) {
      expect(classifyActionRisk("click", label)).toBe("risky");
    }
  });

  it("leaves navigation and lookup alone", () => {
    for (const label of [
      "Search",
      "Find",
      "Sign In",
      "Next",
      "Member Detail",
    ]) {
      expect(classifyActionRisk("click", label)).toBe("safe");
    }
  });

  // The heuristic is pessimistic by design: a false "risky" costs one
  // confirmation, a false "safe" costs an unapproved irreversible action.
  it("prefers over-classifying to under-classifying", () => {
    expect(classifyActionRisk("click", "Open Sub-Account")).not.toBe("safe");
  });
});

describe("describeTarget", () => {
  it("ranks a real accessible name above everything else", () => {
    const t = describeTarget(
      node({ ref: "a", role: "button", label: "Search", name: "Search" }),
      "the Search button",
    );
    expect(t.strategies[0]!.strategy.kind).toBe("role_name");
    expect(t.strategies[0]!.confidence).toBeGreaterThan(0.85);
  });

  it("promotes label proximity when the control has no name of its own", () => {
    const t = describeTarget(
      node({
        ref: "a",
        role: "textbox",
        label: "Member ID",
        name: "",
        adjacentLabel: "Member ID",
        adjacentRelation: "right_of",
        labelSource: "adjacent_text",
      }),
      "the Member ID field",
    );
    expect(t.strategies[0]!.strategy.kind).toBe("label_proximity");
    // It is the only way to address the control, so it is not a hedge.
    expect(t.strategies[0]!.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("always records a positional last resort, and ranks it last", () => {
    const t = describeTarget(
      node({ ref: "a", role: "button", label: "Go", name: "Go" }),
      "x",
    );
    const last = t.strategies[t.strategies.length - 1]!;
    expect(last.strategy.kind).toBe("nth_of_role");
    expect(last.confidence).toBeLessThan(0.3);
  });

  it("never emits a structural selector", () => {
    const t = describeTarget(
      node({ ref: "a", role: "button", label: "Go", name: "Go" }),
      "x",
    );
    expect(
      t.strategies.some(
        (s) => s.strategy.kind === "css" || s.strategy.kind === "xpath",
      ),
    ).toBe(false);
  });

  it("refuses to guess when a descriptor is ambiguous", () => {
    expect(
      describeTarget(node({ ref: "a", role: "button", label: "Go" }), "x")
        .ambiguityPolicy,
    ).toBe("fail");
  });
});

describe("deriveCheckpoint", () => {
  it("asserts on text that appeared, not text that was already there", () => {
    const cp = deriveCheckpoint(
      obs("Sign In"),
      obs("Sign In\nMember Search"),
      "sign in",
    );
    expect(
      cp?.all.some(
        (a) => a.kind === "text_present" && a.text === "Member Search",
      ),
    ).toBe(true);
    expect(
      cp?.all.some((a) => a.kind === "text_present" && a.text === "Sign In"),
    ).toBe(false);
  });

  it("excludes secrets and per-run values, which must never end up in an artifact", () => {
    const cp = deriveCheckpoint(
      obs("Sign In"),
      obs("Sign In\nteller1\nMember Search"),
      "sign in",
      ["teller1"],
    );
    expect(JSON.stringify(cp)).not.toContain("teller1");
  });

  it("ignores content with no readable characters, like a field of password bullets", () => {
    const cp = deriveCheckpoint(
      obs("a"),
      obs("a\n••••••••••"),
      "type a password",
    );
    expect(JSON.stringify(cp ?? {})).not.toContain("•");
  });

  /**
   * A frame created but not yet navigated reports an empty url. It is absent
   * from the "before" set and so looks like a navigation, which used to reach
   * `new URL("")` and throw mid-recording.
   */
  it("does not treat an unnavigated frame as a destination", () => {
    const before = obs("a", [{ name: "top", url: "http://app/" }]);
    const after = obs("a\nLanded", [
      { name: "top", url: "http://app/" },
      { name: "mainFrame", url: "" },
    ]);
    expect(() => deriveCheckpoint(before, after, "click")).not.toThrow();
    const cp = deriveCheckpoint(before, after, "click");
    expect(cp?.all.some((a) => a.kind === "url_matches")).toBe(false);
  });

  it("does record a real navigation", () => {
    const before = obs("a", [{ name: "mainFrame", url: "http://app/one" }]);
    const after = obs("a\nLanded", [
      { name: "mainFrame", url: "http://app/two" },
    ]);
    expect(
      deriveCheckpoint(before, after, "click")?.all.some(
        (a) => a.kind === "url_matches",
      ),
    ).toBe(true);
  });
});
