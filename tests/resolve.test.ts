import { describe, it, expect } from "vitest";
import { resolveTarget, framePathMatches } from "../src/surface/resolve.js";
import type { Observation, SurfaceNode } from "../src/surface/types.js";
import type { TargetDescriptor } from "../src/core/targeting.js";

const node = (
  o: Partial<SurfaceNode> & { ref: string; role: string; label: string },
): SurfaceNode => ({
  name: o.label,
  labelSource: "accessible_name",
  framePath: [],
  ...o,
});

const obs = (nodes: SurfaceNode[]): Observation => ({
  url: "http://app/t/firstcu",
  title: "t",
  frames: [],
  nodes,
  text: "",
  capturedAt: "",
});

const target = (
  strategies: TargetDescriptor["strategies"],
  extra: Partial<TargetDescriptor> = {},
): TargetDescriptor => ({
  describedAs: "x",
  framePath: [],
  ambiguityPolicy: "fail",
  strategies,
  ...extra,
});

describe("resolveTarget", () => {
  it("resolves on the first strategy that matches unambiguously", () => {
    const o = obs([node({ ref: "a", role: "button", label: "Search" })]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "button",
            name: "Search",
            nameMatch: "normalized",
            aliases: [],
          },
          confidence: 0.9,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok && r.node.ref).toBe("a");
    expect(r.ok && r.strategyIndex).toBe(0);
  });

  it("falls through to a lower-ranked strategy when the first finds nothing", () => {
    const o = obs([node({ ref: "a", role: "button", label: "Find" })]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "button",
            name: "Search",
            nameMatch: "normalized",
            aliases: [],
          },
          confidence: 0.9,
          rationale: "",
        },
        {
          strategy: { kind: "nth_of_role", role: "button", index: 0 },
          confidence: 0.4,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok && r.strategyIndex).toBe(1);
  });

  // The central determinism rule: two matches is a halt, not a coin flip.
  it("fails on ambiguity rather than guessing", () => {
    const o = obs([
      node({ ref: "a", role: "button", label: "Search" }),
      node({ ref: "b", role: "button", label: "Search" }),
    ]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "button",
            name: "Search",
            nameMatch: "normalized",
            aliases: [],
          },
          confidence: 0.9,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ reason: "ambiguous" });
  });

  it("honours an explicit opt-in to take the first match, with reduced confidence", () => {
    const o = obs([
      node({ ref: "a", role: "button", label: "Search" }),
      node({ ref: "b", role: "button", label: "Search" }),
    ]);
    const r = resolveTarget(
      target(
        [
          {
            strategy: {
              kind: "role_name",
              role: "button",
              name: "Search",
              nameMatch: "normalized",
              aliases: [],
            },
            confidence: 0.8,
            rationale: "",
          },
        ],
        { ambiguityPolicy: "first" },
      ),
      o,
    );
    expect(r.ok && r.node.ref).toBe("a");
    expect(r.ok && r.confidence).toBeLessThan(0.8);
  });

  it("uses container scope to disambiguate two identically named controls", () => {
    const o = obs([
      node({
        ref: "a",
        role: "button",
        label: "Search",
        container: { role: "form", name: "Member Search" },
      }),
      node({
        ref: "b",
        role: "button",
        label: "Search",
        container: { role: "form", name: "Account Search" },
      }),
    ]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "button",
            name: "Search",
            nameMatch: "normalized",
            aliases: [],
            scope: { role: "form", name: "Member Search" },
          },
          confidence: 0.95,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok && r.node.ref).toBe("a");
  });

  it("normalizes away trailing colons and case, which legacy labels are full of", () => {
    const o = obs([
      node({
        ref: "a",
        role: "textbox",
        label: "Member ID:",
        labelSource: "adjacent_text",
      }),
    ]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "label_proximity",
            labelText: "member id",
            labelMatch: "normalized",
            relation: "right_of",
            controlRole: "textbox",
          },
          confidence: 0.9,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok).toBe(true);
  });

  // This is the multi-tenant seam: one artifact, two institutions that call the
  // same field different things.
  it("matches a tenant-specific label through aliases", () => {
    const summit = obs([
      node({
        ref: "a",
        role: "textbox",
        label: "Member Number",
        labelSource: "adjacent_text",
      }),
    ]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "textbox",
            name: "Member ID",
            nameMatch: "alias",
            aliases: ["Member Number", "Acct ID"],
          },
          confidence: 0.85,
          rationale: "cross-tenant label variance",
        },
      ]),
      summit,
    );
    expect(r.ok && r.node.ref).toBe("a");
  });

  it("will not let a wrapping-label control satisfy an adjacent-cell descriptor", () => {
    const o = obs([
      node({
        ref: "a",
        role: "textbox",
        label: "Member ID",
        labelSource: "associated_label",
      }),
    ]);
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "label_proximity",
            labelText: "Member ID",
            labelMatch: "normalized",
            relation: "wraps",
            controlRole: "textbox",
          },
          confidence: 0.9,
          rationale: "",
        },
      ]),
      o,
    );
    expect(r.ok).toBe(true);
    const o2 = obs([
      node({
        ref: "a",
        role: "textbox",
        label: "Member ID",
        labelSource: "attribute",
      }),
    ]);
    expect(
      resolveTarget(
        target([
          {
            strategy: {
              kind: "label_proximity",
              labelText: "Member ID",
              labelMatch: "normalized",
              relation: "wraps",
              controlRole: "textbox",
            },
            confidence: 0.9,
            rationale: "",
          },
        ]),
        o2,
      ).ok,
    ).toBe(false);
  });

  it("reports not_found with the strategies it tried, for debuggability", () => {
    const r = resolveTarget(
      target([
        {
          strategy: {
            kind: "role_name",
            role: "button",
            name: "Nope",
            nameMatch: "normalized",
            aliases: [],
          },
          confidence: 0.9,
          rationale: "",
        },
      ]),
      obs([]),
    );
    expect(r).toMatchObject({ ok: false, reason: "not_found" });
    expect(!r.ok && r.reason === "not_found" && r.tried).toHaveLength(1);
  });

  it("excludes nodes in a different frame", () => {
    const o = obs([
      node({
        ref: "a",
        role: "button",
        label: "Search",
        framePath: [{ name: "other" }],
      }),
    ]);
    const r = resolveTarget(
      target(
        [
          {
            strategy: {
              kind: "role_name",
              role: "button",
              name: "Search",
              nameMatch: "normalized",
              aliases: [],
            },
            confidence: 0.9,
            rationale: "",
          },
        ],
        { framePath: [{ name: "mainFrame" }] },
      ),
      o,
    );
    expect(r.ok).toBe(false);
  });
});

describe("framePathMatches", () => {
  it("treats an empty recorded path as 'any frame'", () => {
    expect(framePathMatches([], [{ name: "mainFrame" }])).toBe(true);
  });
  it("prefers the frame name over url or index", () => {
    expect(
      framePathMatches(
        [{ name: "mainFrame" }],
        [{ name: "mainFrame", urlPattern: "/other", index: 9 }],
      ),
    ).toBe(true);
  });
  it("falls back to the url pattern when there is no name", () => {
    expect(
      framePathMatches(
        [{ urlPattern: "/t/:id/frame/login" }],
        [{ name: "", urlPattern: "/t/:id/frame/login" }],
      ),
    ).toBe(true);
    expect(
      framePathMatches(
        [{ urlPattern: "/a" }],
        [{ name: "", urlPattern: "/b" }],
      ),
    ).toBe(false);
  });
});
