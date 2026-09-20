import { describe, it, expect } from "vitest";
import {
  activeToken,
  buildReferences,
  matchesPrefix,
  GOAL_PREFIX,
} from "../web/src/console/GoalEditor.tsx";

describe("buildReferences", () => {
  it("offers the run parameter and every secret key", () => {
    const refs = buildReferences("memberId", [
      "corelink.username",
      "corelink.password",
    ]);
    expect(refs.map((r) => r.token)).toEqual([
      "{{memberId}}",
      "{{secret:corelink.username}}",
      "{{secret:corelink.password}}",
    ]);
  });

  it("omits the parameter until one is named", () => {
    expect(buildReferences("  ", ["k"]).map((r) => r.token)).toEqual([
      "{{secret:k}}",
    ]);
  });

  // Secrets are marked so the chip can be styled as the more dangerous thing.
  it("distinguishes secrets from parameters", () => {
    const refs = buildReferences("memberId", ["k"]);
    expect(refs.find((r) => r.token === "{{memberId}}")?.kind).toBe(
      "parameter",
    );
    expect(refs.find((r) => r.token === "{{secret:k}}")?.kind).toBe("secret");
  });
});

describe("activeToken", () => {
  const at = (s: string) => activeToken(s, s.length);

  it("detects a token the moment it is opened", () => {
    expect(at("look up {{")).toEqual({ start: 8, partial: "" });
  });

  it("captures the partial being typed", () => {
    expect(at("look up {{mem")?.partial).toBe("mem");
  });

  it("allows the characters a reference can contain", () => {
    expect(at("{{secret:corelink.pass")?.partial).toBe("secret:corelink.pass");
    expect(at("{{my-ref")?.partial).toBe("my-ref");
  });

  // Once closed, there is nothing to complete.
  it("stops once the token is closed", () => {
    expect(at("look up {{memberId}}")).toBeNull();
  });

  it("is null when no token has been opened", () => {
    expect(at("look up the member")).toBeNull();
  });

  it("does not span a space or other prose", () => {
    expect(at("{{memberId}} and then read")).toBeNull();
    expect(at("{{mem ber")).toBeNull();
  });

  it("tracks the most recent token when several are present", () => {
    const s = "read {{memberId}} then {{sec";
    expect(activeToken(s, s.length)).toEqual({ start: 23, partial: "sec" });
  });

  // The caret may sit mid-string; only text before it counts.
  it("respects the caret rather than the end of the value", () => {
    const s = "read {{mem and later text";
    expect(activeToken(s, 10)).toEqual({ start: 5, partial: "mem" });
  });

  it("reports a start index that replaces the braces too", () => {
    const s = "go {{me";
    const t = activeToken(s, s.length)!;
    expect(s.slice(t.start)).toBe("{{me");
  });
});

describe("GOAL_PREFIX", () => {
  it("is the clause every flow against this application begins with", () => {
    expect(GOAL_PREFIX).toBe("Sign in to the teller console, ");
  });

  it("joins cleanly onto an operator's phrasing", () => {
    expect(GOAL_PREFIX + "look up {{memberId}}.").toBe(
      "Sign in to the teller console, look up {{memberId}}.",
    );
  });
});

describe("matchesPrefix", () => {
  const refs = buildReferences("memberId", [
    "corelink.username",
    "corelink.password",
  ]);
  const find = (partial: string) =>
    refs.filter((r) => matchesPrefix(r, partial)).map((r) => r.token);

  it("shows everything before anything is typed", () => {
    expect(find("")).toHaveLength(3);
  });

  /**
   * The original filter used a substring match, so `{{m` also returned
   * `secret:corelink.username` — "username" contains an "m". Technically a
   * match, useless as a suggestion.
   */
  it("matches on prefix, not substring", () => {
    expect(find("m")).toEqual(["{{memberId}}"]);
  });

  it("matches a whole secret label", () => {
    expect(find("secret")).toEqual([
      "{{secret:corelink.username}}",
      "{{secret:corelink.password}}",
    ]);
  });

  // Segments keep deeper names reachable without loosening into substring.
  it("matches a dotted or colon-separated segment", () => {
    expect(find("user")).toEqual(["{{secret:corelink.username}}"]);
    expect(find("corelink")).toHaveLength(2);
  });

  it("is case-insensitive", () => {
    expect(find("MEMBER")).toEqual(["{{memberId}}"]);
  });

  it("returns nothing for a partial that matches no prefix", () => {
    expect(find("zzz")).toEqual([]);
  });
});
