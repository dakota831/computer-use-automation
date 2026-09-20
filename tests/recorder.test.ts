import { describe, it, expect } from "vitest";
import { classifyActionRisk } from "../src/core/policy.js";
import { recordCapability } from "../src/agent/recorder.js";
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

/**
 * A capability that types one run's data on every future run is broken in a
 * way nothing downstream can detect: it replays cleanly and does the wrong
 * thing. Found when a model typed "100001-S0" for an account number supplied
 * as "0001-100001-S0", and the fragment was recorded as a constant.
 */
/**
 * Two secrets with the same value used to collide in the reverse map, so the
 * capability typed the password into the user-id field. Both credentials are
 * "admin" in the fixture, which is why it replayed fine and was invisible.
 */
describe("templates survive substitution", () => {
  const OBS = obs("Teller Sign In");
  const typed = (template: string, value: string) => ({
    stepId: "s1_type",
    intent: "Enter it",
    kind: "type" as const,
    node: { ref: "r", role: "textbox", label: "User ID" } as any,
    value,
    template,
    before: OBS,
    after: OBS,
  });
  const rec = (actions: any[]) =>
    recordCapability({
      id: "cu.test",
      title: "t",
      description: "d",
      goal: "g",
      entryPoint: "http://127.0.0.1:8080/t/firstcu",
      vendorApp: "corelink-teller",
      parameters: {},
      secretValues: {
        "corelink.username": "admin",
        "corelink.password": "admin",
      },
      actions,
      finalObservation: obs("Member Detail"),
      outputs: [],
      provenance: { provider: "t", model: "t", runId: "r", transcript: "" },
    });

  it("keeps each credential distinct when both resolve to the same string", () => {
    const c = rec([
      typed("{{secret:corelink.username}}", "admin"),
      { ...typed("{{secret:corelink.password}}", "admin"), stepId: "s2_type" },
    ]);
    expect((c.steps[0]!.action as any).value).toBe(
      "{{secret:corelink.username}}",
    );
    expect((c.steps[1]!.action as any).value).toBe(
      "{{secret:corelink.password}}",
    );
  });

  it("never writes a secret's literal value into the artifact", () => {
    const c = rec([typed("{{secret:corelink.username}}", "admin")]);
    expect(JSON.stringify(c)).not.toContain('"admin"');
  });

  it("still infers a template for an action that carries none", () => {
    const c = rec([{ ...typed("", "admin"), template: undefined }]);
    expect((c.steps[0]!.action as any).value).toMatch(/\{\{secret:corelink\./);
  });
});

describe("mangled parameter detection", () => {
  const rec = (typed: string) =>
    recordCapability({
      id: "cu.test",
      title: "t",
      description: "d",
      goal: "g",
      entryPoint: "http://127.0.0.1:8080/t/firstcu",
      vendorApp: "corelink-teller",
      parameters: {
        accountNumber: {
          value: "0001-100001-S0",
          spec: {
            type: "string" as const,
            required: true,
            description: "acct",
            sensitivity: "pii" as const,
          },
        },
      },
      secretValues: {},
      actions: [
        {
          stepId: "s1_type",
          intent: "Enter the account",
          kind: "type",
          node: {
            ref: "ref_1",
            role: "textbox",
            label: "Account Number",
          } as any,
          value: typed,
          before: obs("Post Adjustment"),
          after: obs("Post Adjustment"),
        } as any,
      ],
      finalObservation: obs("Entry Posted"),
      outputs: [],
      provenance: {
        provider: "test",
        model: "test",
        runId: "r1",
        transcript: "",
      },
    });

  it("flags a fragment of a supplied value", () => {
    const step = rec("100001-S0").steps[0]!;
    expect(step.reviewNote).toMatch(/mangled reference/);
    expect(step.reviewNote).toMatch(/\{\{accountNumber\}\}/);
  });

  it("flags a value that swallowed the supplied one", () => {
    expect(rec("0001-100001-S0-X").steps[0]!.reviewNote).toBeDefined();
  });

  it("does not flag the parameter typed correctly", () => {
    const step = rec("0001-100001-S0").steps[0]!;
    expect(step.reviewNote).toBeUndefined();
    expect((step.action as any).value).toBe("{{accountNumber}}");
  });

  it("does not flag a deliberate constant", () => {
    expect(rec("Maintenance Fee").steps[0]!.reviewNote).toBeUndefined();
  });

  it("does not flag something too short to be a coincidence check", () => {
    expect(rec("S0").steps[0]!.reviewNote).toBeUndefined();
  });
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

  /**
   * The case the first version got backwards: it gated the link into the form
   * and waved through the button that actually moved the money.
   */
  it("escalates a committing control to the consequence of its screen", () => {
    const postingScreen =
      "Post Adjustment Account Number Amount Description A posted entry cannot be reversed";
    expect(classifyActionRisk("click", "Confirm", postingScreen)).toBe(
      "irreversible",
    );
    expect(classifyActionRisk("click", "Submit", postingScreen)).toBe(
      "irreversible",
    );
  });

  it("leaves a committing control alone on a harmless screen", () => {
    const filterScreen = "Account Register Filter by Member ID Apply Filter";
    expect(classifyActionRisk("click", "Apply Filter", filterScreen)).toBe(
      "risky",
    );
    expect(classifyActionRisk("click", "Save", "Workstation Preferences")).toBe(
      "risky",
    );
  });

  it("still judges an explicit label without any context", () => {
    expect(classifyActionRisk("click", "Post Adjustment")).toBe("irreversible");
    expect(classifyActionRisk("click", "Confirm")).toBe("risky");
  });

  it("does not let a dangerous-sounding screen promote a navigation click", () => {
    // Only controls that commit inherit the screen's consequence. Moving
    // around a dangerous screen is not itself dangerous.
    const postingScreen = "Post Adjustment Account Number Amount";
    expect(classifyActionRisk("click", "Members", postingScreen)).toBe("safe");
    expect(classifyActionRisk("type", "Amount", postingScreen)).toBe("safe");
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

describe("deriveCheckpoint — volatility", () => {
  /**
   * The shell grew a ticking session clock, and the recorder promptly asserted
   * on "00:00:03" — true exactly once. A checkpoint that cannot hold on the
   * next run is worse than no checkpoint, because it looks like verification.
   */
  it("never asserts on a clock", () => {
    const cp = deriveCheckpoint(
      obs("Teller Console"),
      obs("Teller Console\n00:00:03\nMember Search"),
      "click",
    );
    expect(JSON.stringify(cp ?? {})).not.toContain("00:00:03");
    expect(
      cp?.all.some(
        (a) => a.kind === "text_present" && a.text === "Member Search",
      ),
    ).toBe(true);
  });

  it("never asserts on a date or timestamp", () => {
    for (const volatile of [
      "2026-09-20",
      "9/20/2026",
      "Posted 2026-09-20 at 18:51",
    ]) {
      const cp = deriveCheckpoint(
        obs("x"),
        obs(`x\n${volatile}\nAccount Register`),
        "click",
      );
      expect(JSON.stringify(cp ?? {})).not.toContain(volatile);
    }
  });

  // A balance is true for one member and wrong for every other.
  it("never asserts on a bare currency amount", () => {
    const cp = deriveCheckpoint(
      obs("x"),
      obs("x\n$8,214.55\nMember Detail"),
      "click",
    );
    expect(JSON.stringify(cp ?? {})).not.toContain("8,214.55");
    expect(
      cp?.all.some(
        (a) => a.kind === "text_present" && a.text === "Member Detail",
      ),
    ).toBe(true);
  });

  it("still accepts ordinary screen text", () => {
    const cp = deriveCheckpoint(
      obs("x"),
      obs("x\nSub-Account Created"),
      "click",
    );
    expect(
      cp?.all.some(
        (a) => a.kind === "text_present" && a.text === "Sub-Account Created",
      ),
    ).toBe(true);
  });
});
