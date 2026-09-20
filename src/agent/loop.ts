import type { Capability, ParamSpec, OutputSpec } from "../core/artifact.js";
import { DiscoveryError } from "../core/errors.js";
import {
  PolicyEngine,
  defaultPolicy,
  classifyActionRisk,
} from "../core/policy.js";
import { RunLogger, newRunId } from "../core/log.js";
import { redactor } from "../core/redact.js";
import { resolveTemplate } from "../core/template.js";
import { WebSurface } from "../surface/web.js";
import type { Observation, SurfaceNode } from "../surface/types.js";
import { NimClient, type ChatMessage } from "./llm.js";
import {
  TOOLS,
  TOOL_SCHEMAS,
  TOOL_NAMES,
  normalizeToolName,
  renderObservation,
  systemPrompt,
  type ToolName,
} from "./tools.js";
import { recordCapability, type RecordedAction } from "./recorder.js";

/**
 * The discovery loop: observe -> decide -> act, against a live surface.
 *
 * The model is in the loop here and only here. Everything it does is checked
 * before it happens - arguments against a Zod schema, then the action against
 * the same PolicyEngine that guards replay. A model proposing something outside
 * the allowlist gets an error back as a tool result and another turn; it does
 * not get to act and then be told off afterwards.
 *
 * Refs are the other half of the contract. The model only ever names controls
 * from the current screen, and a ref from a previous turn is rejected rather
 * than silently resolved - a stale ref is the agent equivalent of a stale
 * pointer, and resolving one would act on whatever now happens to hold that id.
 */

export type DiscoverOptions = {
  goal: string;
  entryPoint: string;
  capabilityId: string;
  title: string;
  description: string;
  vendorApp: string;
  tenant?: string;
  allowedOrigins: string[];
  parameters: Record<string, { value: string; spec: Omit<ParamSpec, "name"> }>;
  secrets: Record<string, string>;
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxSteps?: number;
  /**
   * Wall-clock budget for the whole run.
   *
   * Max steps alone is not a bound: provider latency observed on the free tier
   * ranged from 0.8s to 120s per call, so a 22-step run can be 30 seconds or
   * 40 minutes. The brief lists timeout alongside max steps and dead-end as a
   * stopping condition, and this is why.
   */
  timeoutMs?: number;
  headless?: boolean;
  evidenceDir?: string;
  perMinute?: number;
  minSpacingMs?: number;
};

export type DiscoverResult = {
  runId: string;
  capability: Capability;
  artifactPath?: string;
  steps: number;
  modelCalls: number;
  durationMs: number;
  evidenceDir: string;
};

/**
 * The policy engine inspects an action's *type* and the current URL, not its
 * target, so discovery can hand it a placeholder descriptor. Kept explicit
 * rather than cast to `any` so a future policy that does read the target fails
 * to compile here instead of silently checking nothing.
 */
const step0Target = {
  describedAs: "(proposed by the agent)",
  framePath: [],
  strategies: [
    {
      strategy: { kind: "css" as const, selector: ":root" },
      confidence: 0,
      rationale: "placeholder for policy evaluation only",
    },
  ],
  ambiguityPolicy: "fail" as const,
};

export async function discover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const runId = newRunId("discovery");
  const log = new RunLogger(runId, "discovery", { baseDir: opts.evidenceDir });
  const started = Date.now();
  const maxSteps = opts.maxSteps ?? 22;
  const timeoutMs =
    opts.timeoutMs ??
    Number(process.env.DEX_DISCOVERY_TIMEOUT_MS ?? 5 * 60_000);
  const deadline = started + timeoutMs;

  // Register every secret before anything can be written anywhere.
  for (const v of Object.values(opts.secrets)) redactor.registerSecret(v);
  redactor.registerSecret(opts.apiKey);

  const policy = new PolicyEngine(
    { ...defaultPolicy(opts.entryPoint), allowedOrigins: opts.allowedOrigins },
    "discovery",
  );

  const client = new NimClient({
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
    model: opts.model,
    perMinute: opts.perMinute,
    minSpacingMs: opts.minSpacingMs,
    onEvent: (kind, data) => log.event("note", { kind, ...data }),
  });

  log.event("run_started", {
    goal: opts.goal,
    entryPoint: opts.entryPoint,
    model: opts.model,
    maxSteps,
    timeoutMs,
    parameters: Object.keys(opts.parameters),
    secretKeys: Object.keys(opts.secrets),
  });

  const surface = await WebSurface.launch({
    headless: opts.headless ?? true,
    allowedOrigins: opts.allowedOrigins,
    onBlockedRequest: (url) =>
      log.event("policy_verdict", { decision: "deny", layer: "network", url }),
  });

  /**
   * Observe, and wait for the *content frame* to have something in it.
   *
   * The naive version waited for "any actionable node", which was fine until
   * the application grew a real navigation bar: the top-frame menu links are
   * always actionable, so the check passed instantly and the model was shown a
   * page whose working area had not loaded yet. It then reasonably concluded
   * there was no login form and gave up.
   *
   * So when the page has child frames, wait for actionable nodes *inside* one.
   * Chrome is not content, and an agent shown only chrome will either stall or
   * start clicking the menu.
   */
  const observeSettled = async (
    attempts = 6,
    delayMs = 400,
  ): Promise<Observation> => {
    const ready = (o: Observation) => {
      const actionable = o.nodes.filter((n) => !n.readOnly);
      if (!actionable.length) return false;
      const hasChildFrame = o.frames.some((f) => f.depth > 0);
      return hasChildFrame
        ? actionable.some((n) => n.framePath.length > 0)
        : true;
    };
    let obs = await surface.observe();
    for (let i = 1; i < attempts && !ready(obs); i++) {
      await new Promise((r) => setTimeout(r, delayMs));
      obs = await surface.observe();
    }
    return obs;
  };

  const actions: RecordedAction[] = [];
  const outputs: DiscoverResultOutputs = [];
  let modelCalls = 0;
  let stepNo = 0;

  const paramValues = Object.fromEntries(
    Object.entries(opts.parameters).map(([k, v]) => [k, v.value]),
  );

  try {
    await surface.navigate(opts.entryPoint);
    let observation = await observeSettled();

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemPrompt({
          goal: opts.goal,
          entryPoint: opts.entryPoint,
          allowedOrigins: opts.allowedOrigins,
          parameters: paramValues,
          secretKeys: Object.keys(opts.secrets),
          maxSteps,
        }),
      },
      { role: "user", content: renderObservation(observation) },
    ];

    for (stepNo = 1; stepNo <= maxSteps; stepNo++) {
      if (Date.now() > deadline) {
        log.screenshot(await surface.screenshot(), "discovery-timeout");
        throw new DiscoveryError(
          `agent exceeded its ${Math.round(timeoutMs / 1000)}s budget after ${stepNo - 1} step(s)`,
          "timeout",
        );
      }
      const res = await client.chat({
        messages,
        tools: TOOLS,
        toolChoice: "auto",
      });
      modelCalls++;
      log.event("model_response", {
        step: stepNo,
        latencyMs: res.latencyMs,
        usage: res.usage,
        toolCalls: res.toolCalls.map((t) => t.function.name),
        content: res.content?.slice(0, 200),
      });

      const call = res.toolCalls[0];
      if (!call) {
        messages.push({ role: "assistant", content: res.content ?? "" });
        messages.push({
          role: "user",
          content: "You must call exactly one tool. Do not answer in prose.",
        });
        continue;
      }
      messages.push({ role: "assistant", tool_calls: [call] });

      const name = normalizeToolName(call.function.name) as ToolName;
      const schema = TOOL_SCHEMAS[name];
      if (!schema) {
        log.event("note", {
          step: stepNo,
          kind: "unknown_tool",
          raw: call.function.name,
          normalized: name,
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `No such tool "${name}". Valid tools are: ${TOOL_NAMES.join(", ")}.`,
        });
        continue;
      }

      let args: any;
      try {
        args = schema.parse(JSON.parse(call.function.arguments || "{}"));
      } catch (e) {
        // A malformed call is a retry with a specific complaint, never a guess.
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Invalid arguments for ${name}: ${String(e).slice(0, 300)}`,
        });
        continue;
      }

      if (name === "blocked") {
        log.event("escalation_raised", {
          step: stepNo,
          reason: args.reason,
          url: surface.url(),
        });
        log.screenshot(await surface.screenshot(), "discovery-blocked");
        throw new DiscoveryError(
          `agent reported blocked: ${args.reason}`,
          "dead_end",
        );
      }

      if (name === "done") {
        log.event("note", {
          step: stepNo,
          kind: "agent_done",
          summary: args.summary,
        });
        break;
      }

      // Resolve the ref against the CURRENT screen only.
      let node: SurfaceNode | undefined;
      if ("ref" in args) {
        node = observation.nodes.find((n) => n.ref === args.ref);
        if (!node) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `No control "${args.ref}" on the current screen. Refs change every turn - use one from the latest CONTROLS list.`,
          });
          continue;
        }
      }

      const before = observation;
      const stepId = `s${stepNo}_${name}`;

      try {
        if (name === "read") {
          const raw = await surface.readText(node!);
          const looksNumeric = /^[$\s]*-?[\d,]+(\.\d+)?\s*$/.test(raw);
          outputs.push({
            name: args.name,
            description: args.why,
            node: node!,
            type: looksNumeric ? "number" : "string",
            // Anything read off a member record is treated as PII unless it is
            // plainly a figure. Over-classifying costs a redacted log line;
            // under-classifying puts real customer data on disk.
            sensitivity: looksNumeric ? "internal" : "pii",
          });
          log.event("action", {
            step: stepNo,
            stepId,
            type: "read",
            into: args.name,
            chars: raw.length,
          });
          observation = await observeSettled();
          actions.push({
            stepId,
            intent: args.why,
            kind: "read",
            node,
            into: args.name,
            before,
            after: observation,
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Captured "${args.name}".`,
          });
          messages.push({
            role: "user",
            content: renderObservation(observation),
          });
          continue;
        }

        // --- policy, before the action, not after -------------------------
        //
        // Risk is classified from what the model is about to click, using the
        // same heuristic the recorder applies when writing a step. Passing a
        // flat "safe" here would mean discovery never gated anything, which
        // would make the guarantee in REPORT §6 untrue.
        // Gate on the control's own label, not the model's prose. The label is what a
        // human would read before clicking; `why` is free text and a run explained as
        // "submit the search" would otherwise be refused for saying the word.
        const actionRisk = classifyActionRisk(name, node?.label ?? "");
        const proposedAction =
          name === "click"
            ? { type: "click" as const, target: step0Target }
            : name === "type"
              ? {
                  type: "type" as const,
                  target: step0Target,
                  value: "",
                  clearFirst: true,
                }
              : { type: "press" as const, key: String(args.key ?? "Enter") };

        const verdict = policy.check(proposedAction, actionRisk, surface.url());
        log.event("policy_verdict", {
          step: stepNo,
          stepId,
          tool: name,
          riskClass: actionRisk,
          ...verdict,
        });

        if (verdict.decision === "deny") {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: `Refused by policy: ${verdict.reason}`,
          });
          continue;
        }

        if (verdict.decision === "confirm") {
          /**
           * Discovery has no human attached, so a step this risky is refused
           * rather than performed. Recording an irreversible step is a
           * deliberate authoring act, not something a model does unsupervised —
           * and the model is told plainly so it can stop instead of retrying.
           */
          log.event("escalation_raised", {
            step: stepNo,
            stepId,
            reason: verdict.reason,
            url: surface.url(),
            resolution: "refused_during_discovery",
          });
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content:
              `Refused: ${verdict.reason}. Discovery runs unattended, so this action needs a human. ` +
              `If the goal cannot be completed without it, call "blocked" and explain.`,
          });
          continue;
        }

        if (name === "click") {
          log.event("action", {
            step: stepNo,
            stepId,
            type: "click",
            ref: node!.ref,
            label: node!.label,
            why: args.why,
          });
          await surface.click(node!);
        } else if (name === "type") {
          const isSecret = /\{\{\s*secret:/.test(args.text);
          const value = resolveTemplate(
            args.text,
            paramValues,
            (k) => opts.secrets[k],
          );
          log.event("action", {
            step: stepNo,
            stepId,
            type: "type",
            ref: node!.ref,
            label: node!.label,
            template: args.text,
            value: isSecret ? "[secret]" : value,
            why: args.why,
          });
          await surface.type(node!, value, true);
          actions.push({
            stepId,
            intent: args.why,
            kind: "type",
            node,
            value,
            before,
            after: before,
          });
        } else if (name === "press") {
          log.event("action", {
            step: stepNo,
            stepId,
            type: "press",
            key: args.key,
            why: args.why,
          });
          await surface.press(args.key);
        }

        // Let the application settle before showing the model the result.
        observation = await observeSettled();

        if (name === "click")
          actions.push({
            stepId,
            intent: args.why,
            kind: "click",
            node,
            before,
            after: observation,
          });
        if (name === "press")
          actions.push({
            stepId,
            intent: args.why,
            kind: "press",
            key: args.key,
            before,
            after: observation,
          });
        if (name === "type") {
          const rec = actions[actions.length - 1]!;
          rec.after = observation;
        }

        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Done.",
        });
        messages.push({
          role: "user",
          content: renderObservation(observation),
        });
      } catch (e) {
        log.event("note", {
          step: stepNo,
          kind: "action_error",
          error: String(e).slice(0, 300),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: `That failed: ${String(e).slice(0, 200)}`,
        });
        observation = await surface.observe();
        messages.push({
          role: "user",
          content: renderObservation(observation),
        });
      }
    }

    if (stepNo > maxSteps) {
      log.screenshot(await surface.screenshot(), "discovery-max-steps");
      throw new DiscoveryError(
        `agent did not finish within ${maxSteps} steps`,
        "max_steps",
      );
    }

    const finalObservation = await observeSettled();
    log.screenshot(await surface.screenshot(), "discovery-final");
    log.axSnapshot(finalObservation.nodes, "discovery-final");

    const transcript = JSON.stringify(redactor.deep(messages));
    const capability = recordCapability({
      id: opts.capabilityId,
      title: opts.title,
      description: opts.description,
      goal: opts.goal,
      entryPoint: opts.entryPoint,
      vendorApp: opts.vendorApp,
      tenant: opts.tenant,
      parameters: opts.parameters,
      secretValues: opts.secrets,
      actions,
      finalObservation,
      outputs,
      provenance: {
        provider: "nvidia-nim",
        model: opts.model,
        runId,
        transcript,
      },
    });

    log.event("run_finished", {
      status: "success",
      steps: capability.steps.length,
      modelCalls,
      outputs: capability.outputs.map((o) => o.name),
    });
    log.finish({
      status: "success",
      steps: capability.steps.length,
      modelCalls,
    });

    return {
      runId,
      capability,
      steps: capability.steps.length,
      modelCalls,
      durationMs: Date.now() - started,
      evidenceDir: log.dir,
    };
  } finally {
    await surface.close();
  }
}

type DiscoverResultOutputs = {
  name: string;
  description: string;
  node: SurfaceNode;
  type: OutputSpec["type"];
  sensitivity: OutputSpec["sensitivity"];
}[];
