import { z } from "zod";

/**
 * How we find a control on a surface.
 *
 * Design note: the vocabulary here is deliberately *semantic* (role, accessible
 * name, label proximity) rather than structural (CSS, XPath). Two reasons:
 *
 *  1. The real targets are legacy back-office apps with no test IDs, generated
 *     ids like `ctl00$MainContent$txtMemberId`, and table-based layout. A CSS
 *     selector over that markup encodes incidental structure, so it breaks on
 *     changes that a human operator would not even notice.
 *  2. Role + name is the one vocabulary that survives a change of surface. The
 *     same descriptor means something on a web page (CDP accessibility tree),
 *     on Windows (UI Automation) and on macOS (AX API). Structural selectors
 *     are web-only and would paint us into a corner (brief section 3.7).
 *
 * CSS/XPath are still recorded, but ranked last and marked low-trust, so a
 * replay that falls back to them is visible in the logs rather than silent.
 */

/** Which iframe/frameset a control lives in, outermost first. */
export const FrameStep = z.object({
  /** Frame `name` attribute when present - stable in framesets, which is where we need it most. */
  name: z.string().optional(),
  /** Matched against the frame URL. Recorded as a pattern so per-tenant hosts do not break it. */
  urlPattern: z.string().optional(),
  /** Positional fallback when the frame is anonymous. Least stable. */
  index: z.number().int().nonnegative().optional(),
});
export type FrameStep = z.infer<typeof FrameStep>;

/** A container to scope a search to, so "Search" means the button in *this* panel. */
export const ContainerRef = z.object({
  role: z
    .string()
    .describe(
      "ARIA/AX role of the containing region, e.g. form, table, dialog",
    ),
  name: z
    .string()
    .optional()
    .describe("Accessible name of that container when it has one"),
});
export type ContainerRef = z.infer<typeof ContainerRef>;

export const NameMatch = z.enum([
  "exact",
  /** Case/whitespace/punctuation-insensitive. Absorbs "Member ID:" vs "Member Id". */
  "normalized",
  /** Matches any of `aliases`. This is the seam for cross-tenant label differences. */
  "alias",
]);

export const LocatorStrategy = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role_name"),
    role: z.string(),
    name: z.string(),
    nameMatch: NameMatch.default("normalized"),
    aliases: z.array(z.string()).default([]),
    scope: ContainerRef.optional(),
  }),
  z.object({
    /**
     * For the legacy case the accessibility tree cannot solve on its own: an
     * unlabeled <input> in a table cell whose visible label is the cell to its
     * left. Verified during environment setup - CDP returns the label cell but
     * not the input, so this strategy is load-bearing, not theoretical.
     */
    kind: z.literal("label_proximity"),
    labelText: z.string(),
    labelMatch: NameMatch.default("normalized"),
    relation: z.enum(["right_of", "below", "wraps", "after"]),
    controlRole: z
      .string()
      .describe("Role of the control we expect to find, e.g. textbox"),
  }),
  z.object({
    kind: z.literal("nth_of_role"),
    role: z.string(),
    index: z.number().int().nonnegative(),
    scope: ContainerRef.optional(),
  }),
  z.object({ kind: z.literal("css"), selector: z.string() }),
  z.object({ kind: z.literal("xpath"), expression: z.string() }),
]);
export type LocatorStrategy = z.infer<typeof LocatorStrategy>;

export const RankedStrategy = z.object({
  strategy: LocatorStrategy,
  /** Recorder's confidence, 0-1. Drives ordering and shows up in replay logs. */
  confidence: z.number().min(0).max(1),
  /** Why this strategy was recorded. Present so a human reviewer can audit the choice. */
  rationale: z.string(),
});

export const TargetDescriptor = z.object({
  /** Human-readable, for review and for error messages: "the Member ID field". */
  describedAs: z.string(),
  framePath: z.array(FrameStep).default([]),
  /** Tried in order at replay. First unambiguous resolution wins. */
  strategies: z.array(RankedStrategy).min(1),
  /**
   * Recorded for evidence and for a future screenshot/OS-level surface.
   * Never used as a primary locator: coordinates are the least stable thing
   * about a UI and using them silently converts a layout shift into a misclick.
   */
  boundingBoxHint: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
  /**
   * What to do when a strategy matches more than one node.
   * Default is to fail: picking index 0 is how replay quietly acts on the
   * wrong control, which in a banking back-office is the worst failure mode.
   */
  ambiguityPolicy: z.enum(["fail", "first"]).default("fail"),
});
export type TargetDescriptor = z.infer<typeof TargetDescriptor>;
