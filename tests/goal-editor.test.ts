import { describe, it, expect } from "vitest";
import {
  activeToken,
  buildReferences,
  matchesPrefix,
  parseParameters,
  GOAL_PREFIX,
  SUGGESTED_PARAMS,
} from "../web/src/console/GoalEditor.tsx";

describe("parseParameters", () => {
  it("finds every value the goal references", () => {
    expect(
      parseParameters("look up {{memberId}} and open {{accountNumber}}"),
    ).toEqual(["memberId", "accountNumber"]);
  });

  it("reports each name once, in first-use order", () => {
    expect(parseParameters("{{b}} then {{a}} then {{b}}")).toEqual(["b", "a"]);
  });

  it("tolerates whitespace inside the braces", () => {
    expect(parseParameters("read {{ memberId }}")).toEqual(["memberId"]);
  });

  it("ignores an unclosed token", () => {
    expect(parseParameters("read {{member")).toEqual([]);
  });

  it("finds nothing in a goal with no references", () => {
    expect(parseParameters("open the daily totals report")).toEqual([]);
  });

  // Credentials are handled by the executor and are not operator-facing, so
  // a colon-bearing token is not a parameter row to fill in.
  it("does not treat a secret reference as a parameter", () => {
    expect(parseParameters("type {{secret:corelink.password}}")).toEqual([]);
  });
});

describe("buildReferences", () => {
  it("offers the values already in use first", () => {
    const refs = buildReferences("read {{memberId}}");
    expect(refs[0]!.token).toBe("{{memberId}}");
    expect(refs[0]!.suggested).toBeUndefined();
  });

  it("offers suggestions for names not yet used", () => {
    const refs = buildReferences("");
    expect(refs.every((r) => r.suggested)).toBe(true);
    expect(refs.map((r) => r.label)).toEqual([...SUGGESTED_PARAMS]);
  });

  it("does not offer a suggestion that is already in use", () => {
    const refs = buildReferences("read {{memberId}}");
    expect(refs.filter((r) => r.label === "memberId")).toHaveLength(1);
  });

  /**
   * The operator never handles credentials: signing in is a fixed part of every
   * goal and the executor substitutes the values itself.
   */
  it("never exposes a credential reference", () => {
    const refs = buildReferences(
      "type {{secret:corelink.password}} to sign in",
    );
    expect(refs.some((r) => r.token.includes("secret"))).toBe(false);
  });
});

describe("matchesPrefix", () => {
  const refs = buildReferences("read {{memberId}} for {{accountNumber}}");
  const find = (p: string) =>
    refs.filter((r) => matchesPrefix(r, p)).map((r) => r.label);

  it("shows everything before anything is typed", () => {
    expect(find("").length).toBe(refs.length);
  });

  it("matches on prefix, not substring", () => {
    expect(find("mem")).toEqual(["memberId"]);
    // "accountNumber" contains "u" but does not start with it.
    expect(find("u")).toEqual([]);
  });

  it("is case-insensitive", () => {
    expect(find("MEMBER")).toEqual(["memberId"]);
  });

  it("returns nothing for a prefix that matches no name", () => {
    expect(find("zzz")).toEqual([]);
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

  it("stops once the token is closed", () => {
    expect(at("look up {{memberId}}")).toBeNull();
  });

  it("does not span a space or other prose", () => {
    expect(at("{{mem ber")).toBeNull();
    expect(at("{{memberId}} and then read")).toBeNull();
  });

  it("tracks the most recent token when several are present", () => {
    const s = "read {{memberId}} then {{acc";
    expect(activeToken(s, s.length)).toEqual({ start: 23, partial: "acc" });
  });

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
