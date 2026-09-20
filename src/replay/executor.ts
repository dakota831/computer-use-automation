import type { Capability, OutcomeRule, Step } from "../core/artifact.js";
import {
  ReplayFailure,
  type EvidenceRefs,
  type ReplayResult,
} from "../core/errors.js";
import { PolicyEngine, type PolicyMode } from "../core/policy.js";
import { RunLogger, newRunId } from "../core/log.js";
import { redactor } from "../core/redact.js";
import {
  resolveTemplate,
  containsSecret,
  validateInputs,
  type SecretProvider,
} from "../core/template.js";
import { WebSurface } from "../surface/web.js";
import type { Observation, Surface, SurfaceNode } from "../surface/types.js";
import {
  detectOutcome,
  evaluateAssertion,
  extractOutputs,
  waitForCheckpoint,
  type EvalContext,
} from "./outcomes.js";

/**
 * Deterministic replay: the production execution path.
 *
 * No model is consulted for any decision here. Every choice was made at record
 * time and is read out of the artifact, which is what makes a run reproducible
 * and cheap. The engine's whole job is to walk the recorded steps and classify
 * whatever the application does in response.
 *
 * The ordering rule that makes the result contract honest:
 *
 *   **Outcome detectors run before anything is declared a failure.**
 *
 * When a target will not resolve, or a checkpoint does not hold, the first
 * question is not "what broke" but "is this a legitimate answer the application
 * is giving us?" Clicking Search and landing on "no member found" is a correct
 * outcome, not a crash - and a system that checks in the other order reports it
 * as one. That inversion is the mistake the brief warns about, so it is
 * structural here rather than a matter of care.
 */

export type EscalationContext = {
  runId: string;
  capability: Capability;
  step: Step;
  reason: string;
  observation: Observation;
  screenshotPath?: string;
};

export type EscalationDecision =
  /** Human fixed the situation; re-verify the checkpoint and carry on. */
  | { action: "resume" }
  /** Human finished this step manually; skip it and continue. */
  | { action: "step_completed"; note: string }
  /** Human could not or would not proceed. */
  | { action: "abandon"; note: string };

export type ReplayOptions = {
  mode: PolicyMode;
  inputs: Record<string, unknown>;
  secrets?: SecretProvider;
  headless?: boolean;
  evidenceDir?: string;
  /** Injected for tests, or to replay against an already-open session. */
  surface?: Surface;
  /** The human-in-the-loop seam. Absent means "return an escalated result and stop". */
  onEscalation?: (ctx: EscalationContext) => Promise<EscalationDecision>;
  /** Re-authentication hook, invoked by the `reauthenticate` recovery action. */
  onReauthenticate?: (surface: Surface) => Promise<void>;
  /**
   * Called immediately before every action. The server passes a hook that
   * awaits the control lease, so automation parks while a human holds the
   * session rather than racing them for the same page.
   */
  beforeAction?: () => Promise<void>;
};

export async function replay(
  cap: Capability,
  opts: ReplayOptions,
): Promise<ReplayResult> {
  const runId = newRunId("replay");
  const log = new RunLogger(runId, "replay", { baseDir: opts.evidenceDir });
  const started = Date.now();
  const base = { capabilityId: cap.id, version: cap.version, runId };
  const evidence: EvidenceRefs = { logPath: log.logPath };
  /** Nodes we typed a secret into; masked out of every screenshot this run. */
  const maskRefs = new Set<string>();

  log.event("run_started", {
    capabilityId: cap.id,
    version: cap.version,
    status: cap.status,
    mode: opts.mode,
    tenant: cap.tenant,
    inputKeys: Object.keys(opts.inputs),
  });

  // --- gates that cost nothing, before a browser exists -------------------
  const policy = new PolicyEngine(cap.policy, opts.mode, cap.status);
  const approval = policy.checkApproval();
  if (approval.decision === "deny") {
    const f = new ReplayFailure({
      code: "NOT_APPROVED",
      message: approval.reason,
    });
    log.event("run_finished", { status: "failed", failure: f.toJSON() });
    log.finish({ status: "failed", failure: f.toJSON() });
    return {
      ...base,
      status: "failed",
      failure: f.toJSON(),
      durationMs: Date.now() - started,
      evidence,
    };
  }

  const validated = validateInputs(cap.inputs, opts.inputs);
  if (!validated.ok) {
    const f = new ReplayFailure({
      code: "INPUT_INVALID",
      message: validated.errors.join("; "),
    });
    log.event("run_finished", { status: "failed", failure: f.toJSON() });
    log.finish({ status: "failed", failure: f.toJSON() });
    return {
      ...base,
      status: "failed",
      failure: f.toJSON(),
      durationMs: Date.now() - started,
      evidence,
    };
  }
  const inputs = validated.coerced;

  // --- surface ------------------------------------------------------------
  const surface =
    opts.surface ??
    (await WebSurface.launch({
      headless: opts.headless ?? true,
      allowedOrigins: cap.policy.allowedOrigins,
      onBlockedRequest: (url) =>
        log.event("policy_verdict", {
          decision: "deny",
          code: "ORIGIN_NOT_ALLOWED",
          layer: "network",
          url,
        }),
    }));
  const ownsSurface = !opts.surface;

  const snap = async (label: string): Promise<string | undefined> => {
    try {
      return log.screenshot(
        await surface.screenshot({ maskRefs: [...maskRefs] }),
        label,
      );
    } catch {
      return undefined;
    }
  };

  const finishWith = async (result: ReplayResult): Promise<ReplayResult> => {
    log.finish({ status: result.status, durationMs: Date.now() - started });
    if (ownsSurface) await surface.close();
    return result;
  };

  try {
    await surface.navigate(cap.surface.entryPoint);
    let observation = await surface.observe();
    const ctx = (): EvalContext => ({
      surface,
      observation,
      inputs,
      secrets: opts.secrets,
    });
    const reobserve = async () => (observation = await surface.observe());

    for (const step of cap.steps) {
      const stepResult = await runStep(step);
      if (stepResult) return await finishWith(stepResult);
    }

    // --- success condition ------------------------------------------------
    await reobserve();
    const success = await waitForCheckpoint(
      cap.successCondition,
      ctx(),
      reobserve,
    );
    if (!success.ok) {
      // Even at the very end, a declared outcome beats a failure verdict.
      const late = await detectOutcome(cap.outcomes, ctx());
      if (late && late.rule.disposition === "business_outcome") {
        return await finishWith(
          await businessOutcome(late.rule, late.observed),
        );
      }
      const shot = await snap("success-condition-failed");
      const f = new ReplayFailure({
        code: "CHECKPOINT_FAILED",
        message: `success condition not met: ${cap.successCondition.describedAs}`,
        expected: success.failed.map((r) => r.describe).join("; "),
        observed: success.failed.map((r) => r.observed ?? "-").join("; "),
        evidence: { ...evidence, screenshotPath: shot },
      });
      log.event("run_finished", { status: "failed", failure: f.toJSON() });
      return await finishWith({
        ...base,
        status: "failed",
        failure: f.toJSON(),
        durationMs: Date.now() - started,
        evidence: { ...evidence, screenshotPath: shot },
      });
    }

    const { outputs, missing } = await extractOutputs(cap.outputs, ctx());
    if (missing.length) {
      const shot = await snap("outputs-missing");
      const f = new ReplayFailure({
        code: "CHECKPOINT_FAILED",
        message: `reached the success state but could not extract declared outputs: ${missing.join(", ")}`,
        expected: `outputs ${cap.outputs.map((o) => o.name).join(", ")}`,
        observed: `missing ${missing.join(", ")}`,
        evidence: { ...evidence, screenshotPath: shot },
      });
      log.event("run_finished", { status: "failed", failure: f.toJSON() });
      return await finishWith({
        ...base,
        status: "failed",
        failure: f.toJSON(),
        durationMs: Date.now() - started,
        evidence: { ...evidence, screenshotPath: shot },
      });
    }

    // Outputs are logged through the per-field sensitivity declared in the contract.
    log.event("run_finished", {
      status: "success",
      outputs: Object.fromEntries(
        cap.outputs.map((o) => [
          o.name,
          redactor.field(outputs[o.name], o.sensitivity),
        ]),
      ),
    });
    return await finishWith({
      ...base,
      status: "success",
      outputs,
      durationMs: Date.now() - started,
      evidence,
    });

    // ====================================================================
    // step execution
    // ====================================================================
    /** Returns a terminal ReplayResult, or null to continue to the next step. */
    async function runStep(step: Step): Promise<ReplayResult | null> {
      const rules = [...step.outcomes, ...cap.outcomes];
      let attempt = 0;
      const maxAttempts = Math.max(1, ...rules.map((r) => r.maxAttempts));

      for (;;) {
        attempt++;
        log.event("step_started", {
          stepId: step.id,
          intent: step.intent,
          riskClass: step.riskClass,
          attempt,
        });

        // --- policy, per action, every time --------------------------------
        const verdict = policy.check(
          step.action,
          step.riskClass,
          surface.url(),
        );
        log.event("policy_verdict", { stepId: step.id, ...verdict });

        if (verdict.decision === "deny") {
          const shot = await snap(`policy-denied-${step.id}`);
          return fail(
            new ReplayFailure({
              code: "POLICY_VIOLATION",
              message: verdict.reason,
              stepId: step.id,
              expected: "an action permitted by the capability policy",
              observed: verdict.reason,
              evidence: { ...evidence, screenshotPath: shot },
            }),
            shot,
          );
        }

        if (verdict.decision === "confirm") {
          const decision = await escalate(step, verdict.reason);
          if (decision.kind === "result") return decision.result;
          if (decision.kind === "skip") return null; // human completed this step
        }

        // --- resolve the target -------------------------------------------
        await reobserve();
        let node: SurfaceNode | undefined;

        if ("target" in step.action && step.action.target) {
          const r = await surface.resolve(step.action.target, observation);
          log.event("resolution", {
            stepId: step.id,
            target: step.action.target.describedAs,
            ok: r.ok,
            ...(r.ok
              ? {
                  ref: r.node.ref,
                  role: r.node.role,
                  label: r.node.label,
                  strategyIndex: r.strategyIndex,
                  strategyKind: r.strategy.kind,
                  confidence: r.confidence,
                }
              : { reason: r.reason }),
          });

          if (!r.ok) {
            // The page not containing what we expected is frequently the
            // application answering us, not the application being broken.
            const hit = await detectOutcome(rules, ctx());
            if (hit) {
              const handled = await handleOutcome(
                hit.rule,
                hit.observed,
                step,
                attempt,
                maxAttempts,
              );
              if (handled.kind === "result") return handled.result;
              if (handled.kind === "retry") {
                if (await checkpointSatisfiedAfterRecovery(step)) return null;
                continue;
              }
              if (handled.kind === "skip") return null; // step satisfied by the outcome handler
            }
            const shot = await snap(`unresolved-${step.id}`);
            return fail(
              new ReplayFailure({
                code:
                  r.reason === "ambiguous"
                    ? "TARGET_AMBIGUOUS"
                    : "TARGET_NOT_FOUND",
                message:
                  r.reason === "ambiguous"
                    ? `"${step.action.target.describedAs}" matched ${r.candidates.length} controls; refusing to guess`
                    : `could not locate "${step.action.target.describedAs}"`,
                stepId: step.id,
                expected: step.action.target.describedAs,
                observed:
                  r.reason === "ambiguous"
                    ? r.candidates
                        .map((c) => `${c.role} "${c.label}"`)
                        .join(" | ")
                    : `no match from ${r.tried.length} strategies at ${surface.url()}`,
                evidence: { ...evidence, screenshotPath: shot },
              }),
              shot,
            );
          }
          node = r.node;
        }

        // --- act -----------------------------------------------------------
        try {
          await performAction(step, node);
        } catch (e) {
          const shot = await snap(`action-error-${step.id}`);
          return fail(
            new ReplayFailure({
              code: "SURFACE_ERROR",
              message: `action "${step.action.type}" failed: ${String(e)}`,
              stepId: step.id,
              retryable: true,
              evidence: { ...evidence, screenshotPath: shot },
              cause: e,
            }),
            shot,
          );
        }

        // --- wait for a recognised state ------------------------------------
        const settled = await settle(step, rules);

        if (settled.kind === "outcome") {
          const handled = await handleOutcome(
            settled.rule,
            settled.observed,
            step,
            attempt,
            maxAttempts,
          );
          if (handled.kind === "result") return handled.result;
          if (handled.kind === "retry") {
            if (await checkpointSatisfiedAfterRecovery(step)) return null;
            continue;
          }
          if (handled.kind === "skip") return null;
        }

        if (settled.kind === "checkpoint_failed") {
          const shot = await snap(`checkpoint-failed-${step.id}`);
          const axPath = log.axSnapshot(
            observation.nodes,
            `checkpoint-failed-${step.id}`,
          );
          return fail(
            new ReplayFailure({
              code: "CHECKPOINT_FAILED",
              message: `step "${step.id}" did not reach its expected state: ${step.checkpoint!.describedAs}`,
              stepId: step.id,
              expected: settled.failed.map((f) => f.describe).join("; "),
              observed: settled.failed.map((f) => f.observed ?? "-").join("; "),
              evidence: {
                ...evidence,
                screenshotPath: shot,
                axSnapshotPath: axPath,
              },
            }),
            shot,
            axPath,
          );
        }

        return null; // step done
      }
    }

    /**
     * After a recovery action, verify the checkpoint before re-running anything.
     *
     * A "dismiss the interstitial" recovery has usually already advanced the
     * application past the point the step was trying to reach. Blindly retrying
     * the action then looks for a control that is no longer on screen and fails
     * with a confusing TARGET_NOT_FOUND. Recovery resumes at the checkpoint;
     * only if that still does not hold do we re-run the action.
     */
    async function checkpointSatisfiedAfterRecovery(
      step: Step,
    ): Promise<boolean> {
      if (!step.checkpoint || !step.checkpoint.all.length) return false;
      await reobserve();
      const cp = await waitForCheckpoint(step.checkpoint, ctx(), reobserve);
      log.event("checkpoint", {
        stepId: step.id,
        ok: cp.ok,
        attempts: cp.attempts,
        phase: "after_recovery",
        describedAs: step.checkpoint.describedAs,
      });
      return cp.ok;
    }

    /**
     * Wait for the application to reach a state we recognise.
     *
     * An action that submits a form starts a navigation, so observing straight
     * afterwards samples the *old* page. The original implementation checked the
     * outcome detectors exactly once, immediately, and then polled only the
     * checkpoint - which meant a page that legitimately answered "you do not
     * have permission" was missed, the checkpoint later matched the shared panel
     * title, and a clean business outcome was reported as an extraction failure.
     *
     * So both are polled together. After every action we wait until the page is
     * either where we expected to be (checkpoint) or somewhere we explicitly
     * know about (an outcome detector), whichever happens first. Timing out
     * means neither - and that is a genuine failure worth surfacing.
     *
     * Steps with no checkpoint still settle briefly, because "nothing to verify"
     * is not the same as "nothing can go wrong".
     */
    type Settled =
      | { kind: "ok" }
      | { kind: "outcome"; rule: OutcomeRule; observed?: string }
      | {
          kind: "checkpoint_failed";
          failed: { describe: string; observed?: string }[];
        };

    async function settle(step: Step, rules: OutcomeRule[]): Promise<Settled> {
      const hasCheckpoint = !!step.checkpoint?.all.length;
      const budget = hasCheckpoint ? step.checkpoint!.timeoutMs : 1200;
      const deadline = Date.now() + budget;
      let failed: { describe: string; observed?: string }[] = [];
      let polls = 0;

      for (;;) {
        polls++;
        await reobserve();

        const hit = await detectOutcome(rules, ctx());
        if (hit)
          return { kind: "outcome", rule: hit.rule, observed: hit.observed };

        if (hasCheckpoint) {
          const results = [];
          for (const a of step.checkpoint!.all)
            results.push(await evaluateAssertion(a, ctx()));
          failed = results
            .filter((r) => !r.ok)
            .map((r) => ({ describe: r.describe, observed: r.observed }));
          if (failed.length === 0) {
            log.event("checkpoint", {
              stepId: step.id,
              ok: true,
              polls,
              describedAs: step.checkpoint!.describedAs,
            });
            return { kind: "ok" };
          }
        } else if (polls >= 2) {
          return { kind: "ok" };
        }

        if (Date.now() >= deadline) {
          if (!hasCheckpoint) return { kind: "ok" };
          log.event("checkpoint", {
            stepId: step.id,
            ok: false,
            polls,
            describedAs: step.checkpoint!.describedAs,
            failed,
          });
          return { kind: "checkpoint_failed", failed };
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    async function performAction(
      step: Step,
      node?: SurfaceNode,
    ): Promise<void> {
      // Park here if a human currently holds the session. This is the
      // automation side of the control lease; the server enforces the
      // operator side before dispatching their input. Both guard one page.
      if (opts.beforeAction) await opts.beforeAction();
      const a = step.action;
      switch (a.type) {
        case "navigate":
          log.event("action", { stepId: step.id, type: a.type, url: a.url });
          return surface.navigate(resolveTemplate(a.url, inputs, opts.secrets));
        case "click":
          log.event("action", {
            stepId: step.id,
            type: a.type,
            ref: node?.ref,
            label: node?.label,
          });
          return surface.click(node!);
        case "type": {
          const secret = containsSecret(a.value);
          const value = resolveTemplate(a.value, inputs, opts.secrets);
          if (secret && node) maskRefs.add(node.ref);
          // The resolved value is never logged when it came from a secret, and is
          // routed through the redactor even when it did not.
          log.event("action", {
            stepId: step.id,
            type: a.type,
            ref: node?.ref,
            label: node?.label,
            value: secret ? "[secret]" : value,
          });
          return surface.type(node!, value, a.clearFirst);
        }
        case "select":
          log.event("action", {
            stepId: step.id,
            type: a.type,
            ref: node?.ref,
            value: a.value,
          });
          return surface.select(
            node!,
            resolveTemplate(a.value, inputs, opts.secrets),
          );
        case "press":
          log.event("action", { stepId: step.id, type: a.type, key: a.key });
          return surface.press(a.key);
        case "read": {
          const text = await surface.readText(node!);
          log.event("action", {
            stepId: step.id,
            type: a.type,
            into: a.into,
            chars: text.length,
          });
          inputs[a.into] = text;
          return;
        }
        case "wait_for": {
          const deadline = Date.now() + a.timeoutMs;
          for (;;) {
            if ((await evaluateAssertion(a.assertion, ctx())).ok) return;
            if (Date.now() >= deadline) {
              throw new ReplayFailure({
                code: "TIMEOUT",
                message: `wait_for timed out after ${a.timeoutMs}ms`,
                stepId: step.id,
              });
            }
            await new Promise((r) => setTimeout(r, 300));
            await reobserve();
          }
        }
      }
    }

    // --- outcome handling -------------------------------------------------
    type Handled =
      | { kind: "result"; result: ReplayResult }
      | { kind: "retry" }
      | { kind: "skip" }
      | { kind: "continue" };

    async function handleOutcome(
      rule: OutcomeRule,
      observed: string | undefined,
      step: Step,
      attempt: number,
      maxAttempts: number,
    ): Promise<Handled> {
      log.event("outcome_detected", {
        stepId: step.id,
        code: rule.code,
        disposition: rule.disposition,
        describedAs: rule.describedAs,
        observed,
        attempt,
      });

      switch (rule.disposition) {
        case "business_outcome":
          return {
            kind: "result",
            result: await businessOutcome(rule, observed),
          };

        case "recover": {
          if (attempt >= Math.min(rule.maxAttempts, maxAttempts)) {
            const shot = await snap(`recovery-exhausted-${step.id}`);
            return {
              kind: "result",
              result: failResult(
                new ReplayFailure({
                  code: "RECOVERY_EXHAUSTED",
                  message: `"${rule.code}" recurred ${attempt} times and did not clear`,
                  stepId: step.id,
                  expected: `${rule.describedAs} to resolve`,
                  observed,
                  evidence: { ...evidence, screenshotPath: shot },
                }),
                { ...evidence, screenshotPath: shot },
              ),
            };
          }
          await applyRecovery(rule, step);
          return { kind: "retry" };
        }

        case "escalate": {
          const d = await escalate(step, `${rule.code}: ${rule.describedAs}`);
          if (d.kind === "result") return { kind: "result", result: d.result };
          return d.kind === "skip" ? { kind: "skip" } : { kind: "retry" };
        }

        case "fail": {
          const shot = await snap(`outcome-fail-${step.id}`);
          return {
            kind: "result",
            result: failResult(
              new ReplayFailure({
                code:
                  rule.code === "APP_ERROR" ? "APP_ERROR" : "CHECKPOINT_FAILED",
                message: `${rule.code}: ${rule.describedAs}`,
                stepId: step.id,
                expected: "the step to proceed normally",
                observed,
                evidence: { ...evidence, screenshotPath: shot },
              }),
              { ...evidence, screenshotPath: shot },
            ),
          };
        }
      }
    }

    async function applyRecovery(rule: OutcomeRule, step: Step): Promise<void> {
      const r = rule.recovery;
      log.event("recovery", {
        stepId: step.id,
        code: rule.code,
        action: r?.do ?? "none",
      });
      if (!r) return;
      switch (r.do) {
        case "dismiss": {
          const res = await surface.resolve(r.target, observation);
          if (res.ok) await surface.click(res.node);
          await reobserve();
          return;
        }
        case "wait_retry":
          await new Promise((x) => setTimeout(x, r.delayMs));
          await reobserve();
          return;
        case "reauthenticate":
          if (!opts.onReauthenticate) {
            throw new ReplayFailure({
              code: "RECOVERY_EXHAUSTED",
              message:
                "session expired and no re-authentication handler is configured",
              stepId: step.id,
            });
          }
          await opts.onReauthenticate(surface);
          await reobserve();
          return;
      }
    }

    // --- escalation -------------------------------------------------------
    async function escalate(
      step: Step,
      reason: string,
    ): Promise<
      | { kind: "result"; result: ReplayResult }
      | { kind: "retry" }
      | { kind: "skip" }
    > {
      const shot = await snap(`escalation-${step.id}`);
      const interventionId = `iv_${runId}_${step.id}`;
      log.event("escalation_raised", {
        stepId: step.id,
        interventionId,
        reason,
        url: surface.url(),
      });

      if (!opts.onEscalation) {
        // No handler: hand the situation back to the caller rather than pressing
        // on. The server supplies a handler; the CLI deliberately does not.
        return {
          kind: "result",
          result: {
            ...base,
            status: "escalated",
            interventionId,
            evidence: { ...evidence, screenshotPath: shot },
          },
        };
      }

      const decision = await opts.onEscalation({
        runId,
        capability: cap,
        step,
        reason,
        observation,
        screenshotPath: shot,
      });
      log.event("control_transferred", {
        stepId: step.id,
        interventionId,
        decision: decision.action,
        ...("note" in decision ? { note: decision.note } : {}),
      });

      if (decision.action === "resume") return { kind: "retry" };
      if (decision.action === "step_completed") {
        log.event("human_action", { stepId: step.id, note: decision.note });
        return { kind: "skip" };
      }
      return {
        kind: "result",
        result: {
          ...base,
          status: "escalated",
          interventionId,
          resolution: "abandoned",
          evidence: { ...evidence, screenshotPath: shot },
        },
      };
    }

    // --- terminal helpers -------------------------------------------------
    async function businessOutcome(
      rule: OutcomeRule,
      observed?: string,
    ): Promise<ReplayResult> {
      const partial = await extractOutputs(cap.outputs, ctx())
        .then((r) => r.outputs)
        .catch(() => ({}));
      const result: ReplayResult = {
        ...base,
        status: "outcome",
        outcome: { code: rule.code, message: rule.describedAs, data: partial },
        durationMs: Date.now() - started,
        evidence,
      };
      log.event("run_finished", {
        status: "outcome",
        code: rule.code,
        observed,
      });
      return result;
    }

    function failResult(f: ReplayFailure, ev: EvidenceRefs): ReplayResult {
      log.event("run_finished", { status: "failed", failure: f.toJSON() });
      return {
        ...base,
        status: "failed",
        failure: f.toJSON(),
        durationMs: Date.now() - started,
        evidence: ev,
      };
    }

    function fail(f: ReplayFailure, shot?: string, ax?: string): ReplayResult {
      return failResult(f, {
        ...evidence,
        screenshotPath: shot,
        axSnapshotPath: ax,
      });
    }
  } catch (e) {
    const f =
      e instanceof ReplayFailure
        ? e
        : new ReplayFailure({
            code: "SURFACE_ERROR",
            message: String(e),
            cause: e,
          });
    log.event("run_finished", { status: "failed", failure: f.toJSON() });
    return await finishWith({
      ...base,
      status: "failed",
      failure: f.toJSON(),
      durationMs: Date.now() - started,
      evidence,
    });
  }
}
