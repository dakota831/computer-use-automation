import { z } from "zod";
import { TargetDescriptor } from "./targeting.js";

/**
 * Assertions do triple duty in this system, deliberately:
 *
 *   - as a step *checkpoint*  ("did the click actually get me to the detail screen?")
 *   - as the capability *success condition*
 *   - as an outcome/error *detector* ("is this the 'no such member' screen?")
 *
 * Keeping one vocabulary for all three means a reviewer reads one concept, and
 * the replay engine has one evaluator to get right. It also forces the useful
 * discipline that detecting "record not found" is the same kind of act as
 * confirming success - which is exactly the distinction the brief warns about
 * collapsing.
 *
 * Assertions are intentionally NOT recursive. A checkpoint is a flat list that
 * must all hold (implicit AND). Nested boolean trees would be more expressive
 * and much harder for a human to review, and review is the point.
 */
export const Assertion = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("url_matches"),
    /** Regex. Recorded parameterised (/member/\d+) rather than literal, so it survives other inputs. */
    pattern: z.string(),
  }),
  z.object({
    kind: z.literal("text_present"),
    text: z.string(),
    /** Scoping matters: "Error" in a hidden template is not "Error" in the message region. */
    within: TargetDescriptor.optional(),
    match: z.enum(["exact", "normalized", "regex"]).default("normalized"),
  }),
  z.object({ kind: z.literal("text_absent"), text: z.string(), within: TargetDescriptor.optional() }),
  z.object({ kind: z.literal("element_present"), target: TargetDescriptor }),
  z.object({ kind: z.literal("element_absent"), target: TargetDescriptor }),
  z.object({
    kind: z.literal("value_equals"),
    target: TargetDescriptor,
    /** May be a template, e.g. "{{memberId}}" - lets a checkpoint verify what we typed stuck. */
    expected: z.string(),
  }),
]);
export type Assertion = z.infer<typeof Assertion>;

/** A checkpoint is a conjunction. Empty means "no verification", which the recorder flags. */
export const Checkpoint = z.object({
  all: z.array(Assertion).default([]),
  /** How long to wait for the conjunction to become true before deciding it failed. */
  timeoutMs: z.number().int().positive().default(10_000),
  /** Shown in failure output so a human immediately knows what we were waiting for. */
  describedAs: z.string(),
});
export type Checkpoint = z.infer<typeof Checkpoint>;
