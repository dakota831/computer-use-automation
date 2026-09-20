import { z } from "zod";
import type { ToolDef } from "./llm.js";
import type { Observation } from "../surface/types.js";

/**
 * The action vocabulary offered to the model.
 *
 * Kept small and close to the recorded `Action` type, so what the model does and
 * what gets recorded are near-identical. Every argument set is validated with
 * Zod before anything touches the browser: a weaker model producing a malformed
 * call becomes a retry with a specific error message rather than a crash or, far
 * worse, a plausible-looking wrong click.
 *
 * `type` takes a template rather than a literal for credentials. The model is
 * told which secret *keys* exist and emits "{{secret:corelink.password}}"; the
 * loop substitutes the value at the moment of typing. The model therefore never
 * sees a credential, and neither does the transcript.
 */

export const ClickArgs = z.object({ ref: z.string(), why: z.string() });
export const TypeArgs = z.object({
  ref: z.string(),
  text: z.string(),
  why: z.string(),
});
export const PressArgs = z.object({ key: z.string(), why: z.string() });
export const ReadArgs = z.object({
  ref: z.string(),
  name: z.string(),
  why: z.string(),
});
export const DoneArgs = z.object({ summary: z.string() });
export const BlockedArgs = z.object({ reason: z.string() });

export const TOOL_SCHEMAS = {
  click: ClickArgs,
  type: TypeArgs,
  press: PressArgs,
  read: ReadArgs,
  done: DoneArgs,
  blocked: BlockedArgs,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/**
 * Normalise a tool name coming back from the provider.
 *
 * Observed with openai/gpt-oss-20b on NIM: the model's Harmony response format
 * leaks into the function name, so "click" arrives as "click<|channel|>commentary".
 * Other providers prefix names with "functions.". Neither is the model failing to
 * choose a tool - it chose correctly and the wire format is noisy.
 *
 * Normalising here rather than in the loop keeps the quirk at the boundary where
 * it belongs, and means swapping models does not move the workaround around.
 */
export function normalizeToolName(raw: string): string {
  return raw
    .split("<|")[0]! // Harmony channel markers
    .split("\n")[0]!
    .replace(/^functions\./, "") // some providers namespace tool names
    .trim();
}

export const TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

const fn = (name: string, description: string, shape: z.ZodType): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: z.toJSONSchema(shape) as Record<string, unknown>,
  },
});

export const TOOLS: ToolDef[] = [
  fn(
    "click",
    "Click a control. Use the ref from the CONTROLS list.",
    ClickArgs,
  ),
  fn(
    "type",
    "Type into a field. For credentials use a template like {{secret:corelink.password}} - never a literal password. For run parameters use {{paramName}}.",
    TypeArgs,
  ),
  fn("press", "Press a single key, e.g. Enter or Tab.", PressArgs),
  fn(
    "read",
    "Capture a value visible on screen as a named output of this capability.",
    ReadArgs,
  ),
  fn(
    "done",
    "The goal is achieved and every required value has been read.",
    DoneArgs,
  ),
  fn(
    "blocked",
    "You cannot proceed safely. Explain what is blocking you.",
    BlockedArgs,
  ),
];

/**
 * Render an observation for the model.
 *
 * Deliberately not raw HTML or a raw AX dump. The model is shown the same
 * abstraction the recorder works in - role, label, and where the label came
 * from - so what it reasons about and what gets recorded are the same thing.
 * Showing it markup would invite CSS selectors, which is exactly the coupling
 * this system avoids.
 */
export function renderObservation(obs: Observation, maxTextLines = 40): string {
  const frame = obs.frames.find((f) => f.depth > 0);
  const lines: string[] = [];
  lines.push(`URL: ${obs.url}`);
  if (frame)
    lines.push(`CONTENT FRAME: ${frame.name || "(unnamed)"} -> ${frame.url}`);

  lines.push("", "CONTROLS (act on these by ref):");
  const actionable = obs.nodes.filter((n) => !n.readOnly);
  if (!actionable.length) lines.push("  (none)");
  for (const n of actionable) {
    const how =
      n.labelSource === "accessible_name"
        ? ""
        : `  [label from ${n.adjacentRelation ?? "adjacent"} text]`;
    const val = n.value ? `  value="${n.value}"` : "";
    lines.push(
      `  ${n.ref.padEnd(8)} ${n.role.padEnd(9)} "${n.label}"${val}${how}`,
    );
  }

  const readable = obs.nodes.filter((n) => n.readOnly && n.adjacentLabel);
  if (readable.length) {
    lines.push("", "VALUES ON SCREEN (read these by ref):");
    for (const n of readable.slice(0, 30)) {
      lines.push(`  ${n.ref.padEnd(8)} "${n.adjacentLabel}" = "${n.label}"`);
    }
  }

  const text = obs.text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const dedup = text.filter((l) => (seen.has(l) ? false : (seen.add(l), true)));
  lines.push("", "VISIBLE TEXT:");
  for (const l of dedup.slice(0, maxTextLines)) lines.push(`  ${l}`);

  return lines.join("\n");
}

export function systemPrompt(args: {
  goal: string;
  entryPoint: string;
  allowedOrigins: string[];
  parameters: Record<string, string>;
  secretKeys: string[];
  maxSteps: number;
}): string {
  return `You operate a back-office banking application through its user interface, the way a human teller would. You cannot call APIs; the only way in is the screen.

GOAL
${args.goal}

You are on: ${args.entryPoint}

HOW YOU SEE THE SCREEN
Each turn you get the current controls and visible text. Controls are identified by a ref such as ref_3. Refs change every turn - always use refs from the LATEST screen, never one you remember.

Many controls in this application have no accessible name of their own; their label is the text beside them. Those are marked "[label from right_of text]" and are addressed the same way.

This application has a navigation bar and other surrounding chrome. The work happens in the CONTENT FRAME named in the header above - controls listed with a frame are the ones that advance your task. Do not use the top-level navigation unless the goal actually calls for changing section; clicking it will take you away from the screen you are working on.

VALUES YOU MAY USE
Run parameters (use the template, not the literal value): ${
    Object.keys(args.parameters).length
      ? Object.keys(args.parameters)
          .map((k) => `{{${k}}}`)
          .join(", ")
      : "(none)"
  }
Credentials (use the template - you are never shown the actual secret): ${
    args.secretKeys.length
      ? args.secretKeys.map((k) => `{{secret:${k}}}`).join(", ")
      : "(none)"
  }

RULES
- One tool call per turn. Always explain why in the "why" field.
- You may only operate within: ${args.allowedOrigins.join(", ")}
- Never type a literal password. Use the {{secret:...}} template.
- Before calling done, use "read" to capture every value the goal asks for.
- If you are stuck, blocked, or would have to guess at something irreversible, call "blocked" and explain. Stopping is always better than guessing.
- You have at most ${args.maxSteps} steps.`;
}
