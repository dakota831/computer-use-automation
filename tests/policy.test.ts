import { describe, it, expect } from "vitest";
import {
  PolicyEngine,
  urlMatchesEntry,
  defaultPolicy,
} from "../src/core/policy.js";
import type { Action } from "../src/core/artifact.js";

const APP = "http://127.0.0.1:8080";

describe("urlMatchesEntry", () => {
  it("permits the whole origin when the entry has no path", () => {
    expect(urlMatchesEntry(`${APP}/t/firstcu/frame/search`, APP)).toBe(true);
  });

  it("honours a /* prefix", () => {
    expect(
      urlMatchesEntry(`${APP}/t/firstcu/frame/search`, `${APP}/t/firstcu/*`),
    ).toBe(true);
  });

  // The classic prefix-confusion bug: naive startsWith lets an attacker-controlled
  // sibling path through because it shares a string prefix with the allowed one.
  it("does not let a sibling path masquerade as an allowed prefix", () => {
    expect(
      urlMatchesEntry(`${APP}/t/firstcu-evil/x`, `${APP}/t/firstcu/*`),
    ).toBe(false);
  });

  it("rejects a different port, host or scheme", () => {
    expect(urlMatchesEntry("http://127.0.0.1:9999/t/firstcu", `${APP}/*`)).toBe(
      false,
    );
    expect(urlMatchesEntry("http://evil.test:8080/t/firstcu", `${APP}/*`)).toBe(
      false,
    );
    expect(
      urlMatchesEntry("https://127.0.0.1:8080/t/firstcu", `${APP}/*`),
    ).toBe(false);
  });

  it("is not fooled by a host that merely ends with the allowed host", () => {
    expect(urlMatchesEntry("http://evil-127.0.0.1:8080/", `${APP}`)).toBe(
      false,
    );
  });

  it("returns false rather than throwing on malformed input", () => {
    expect(urlMatchesEntry("not a url", APP)).toBe(false);
  });
});

describe("PolicyEngine", () => {
  const policy = {
    ...defaultPolicy(APP),
    allowedOrigins: [`${APP}/t/firstcu/*`],
  };
  const nav = (url: string): Action => ({ type: "navigate", url });
  const click: Action = {
    type: "click",
    target: {
      describedAs: "x",
      framePath: [],
      strategies: [
        {
          strategy: { kind: "css", selector: "b" },
          confidence: 0.1,
          rationale: "t",
        },
      ],
      ambiguityPolicy: "fail",
    },
  };

  it("allows an in-scope navigation", () => {
    const e = new PolicyEngine(policy, "discovery");
    expect(e.check(nav(`${APP}/t/firstcu/frame/search`), "safe").decision).toBe(
      "allow",
    );
  });

  it("denies navigation outside the allowlist", () => {
    const e = new PolicyEngine(policy, "discovery");
    const v = e.check(nav("http://example.com/"), "safe");
    expect(v.decision).toBe("deny");
    expect(v).toMatchObject({ code: "ORIGIN_NOT_ALLOWED" });
  });

  // A session that has drifted off-allowlist must not keep acting, even though
  // the action itself is only a click.
  it("denies a non-navigation action when the current URL has drifted off-list", () => {
    const e = new PolicyEngine(policy, "discovery");
    const v = e.check(click, "safe", "http://example.com/evil");
    expect(v).toMatchObject({ decision: "deny", code: "ORIGIN_NOT_ALLOWED" });
  });

  it("denies an action type that is not allowlisted", () => {
    const e = new PolicyEngine(
      { ...policy, allowedActions: ["read"] },
      "discovery",
    );
    expect(e.check(click, "safe", `${APP}/t/firstcu/x`)).toMatchObject({
      code: "ACTION_NOT_ALLOWED",
    });
  });

  it("requires confirmation for an irreversible step", () => {
    const e = new PolicyEngine(policy, "replay_attended");
    expect(e.check(click, "irreversible", `${APP}/t/firstcu/x`)).toMatchObject({
      decision: "confirm",
      code: "RISK_REQUIRES_CONFIRMATION",
    });
  });

  it("lets a stricter policy escalate merely risky steps too", () => {
    const e = new PolicyEngine(
      { ...policy, confirmAtOrAbove: "risky" },
      "replay_attended",
    );
    expect(e.check(click, "risky", `${APP}/t/firstcu/x`).decision).toBe(
      "confirm",
    );
    expect(e.check(click, "safe", `${APP}/t/firstcu/x`).decision).toBe("allow");
  });

  it("blocks unattended replay of a draft capability", () => {
    expect(
      new PolicyEngine(policy, "replay_unattended", "draft").checkApproval(),
    ).toMatchObject({
      decision: "deny",
      code: "NOT_APPROVED",
    });
    expect(
      new PolicyEngine(policy, "replay_unattended", "approved").checkApproval()
        .decision,
    ).toBe("allow");
    // Attended replay of a draft is the whole point of attended mode.
    expect(
      new PolicyEngine(policy, "replay_attended", "draft").checkApproval()
        .decision,
    ).toBe("allow");
  });

  it("refuses to run a deprecated capability in any mode", () => {
    expect(
      new PolicyEngine(policy, "replay_attended", "deprecated").checkApproval()
        .decision,
    ).toBe("deny");
  });
});
