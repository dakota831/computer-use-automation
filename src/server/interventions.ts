import { randomUUID } from "node:crypto";
import { ControlLease, type LeaseEvent } from "./lease.js";
import type {
  EscalationContext,
  EscalationDecision,
} from "../replay/executor.js";
import type { Surface } from "../surface/types.js";
import type { RunLogger } from "../core/log.js";

/**
 * The escalation registry.
 *
 * When replay cannot safely proceed it calls `raise()`, which returns a promise.
 * That promise is the pause: the run is suspended on a live session, not torn
 * down, and it resolves only when a human decides what should happen. The
 * session, its cookies, and its position in the flow all survive the handoff,
 * which is the entire requirement.
 *
 * What a human does while holding control is recorded in the same shape the
 * automation records its own actions. That is deliberate: the obvious next step
 * is to turn a handoff into a proposed amendment to the capability, so the
 * system learns the missing step instead of escalating forever. Not built here,
 * but the data is captured in the right form for it (see REPORT.md, Cuts).
 */

export type InterventionStatus =
  "pending" | "operator_controlling" | "resolved";

export type HumanAction = {
  at: string;
  kind: "click" | "key" | "note";
  detail: Record<string, unknown>;
};

export type Intervention = {
  id: string;
  runId: string;
  capabilityId: string;
  version: string;
  goal: string;
  stepId: string;
  stepIntent: string;
  reason: string;
  raisedAt: string;
  status: InterventionStatus;
  url: string;
  screenshotPath?: string;
  humanActions: HumanAction[];
  lease: ControlLease;
  surface: Surface;
  log?: RunLogger;
  resolve: (d: EscalationDecision) => void;
};

/** What the console sees. Deliberately excludes the live surface handle. */
export type InterventionView = Omit<
  Intervention,
  "lease" | "surface" | "resolve" | "log"
> & {
  owner: string;
  holder: string;
  leaseHistory: LeaseEvent[];
};

export class InterventionRegistry {
  private readonly items = new Map<string, Intervention>();

  view(i: Intervention): InterventionView {
    const { lease, surface, resolve, log, ...rest } = i;
    return {
      ...rest,
      owner: lease.owner,
      holder: lease.holder,
      leaseHistory: lease.history,
    };
  }

  list(): InterventionView[] {
    return [...this.items.values()]
      .sort((a, b) => b.raisedAt.localeCompare(a.raisedAt))
      .map((i) => this.view(i));
  }

  get(id: string): Intervention | undefined {
    return this.items.get(id);
  }

  /**
   * Raise an intervention and wait for a human.
   *
   * The returned promise is handed straight back to the replay executor as the
   * result of its `onEscalation` hook, so "paused awaiting a human" is just an
   * un-awaited promise rather than a polling loop or a state machine.
   */
  raise(args: {
    ctx: EscalationContext;
    surface: Surface;
    lease: ControlLease;
    log?: RunLogger;
    version: string;
  }): { intervention: Intervention; decided: Promise<EscalationDecision> } {
    const id = `iv_${randomUUID().slice(0, 8)}`;
    let resolve!: (d: EscalationDecision) => void;
    const decided = new Promise<EscalationDecision>((r) => (resolve = r));

    const intervention: Intervention = {
      id,
      runId: args.ctx.runId,
      capabilityId: args.ctx.capability.id,
      version: args.version,
      goal: args.ctx.capability.title,
      stepId: args.ctx.step.id,
      stepIntent: args.ctx.step.intent,
      reason: args.ctx.reason,
      raisedAt: new Date().toISOString(),
      status: "pending",
      url: args.ctx.observation.url,
      screenshotPath: args.ctx.screenshotPath,
      humanActions: [],
      lease: args.lease,
      surface: args.surface,
      log: args.log,
      resolve,
    };

    this.items.set(id, intervention);
    args.log?.event("escalation_raised", {
      interventionId: id,
      stepId: intervention.stepId,
      reason: intervention.reason,
      url: intervention.url,
    });
    return { intervention, decided };
  }

  /** A named human takes the session. */
  take(id: string, actor: string): InterventionView {
    const i = this.require(id);
    if (i.status === "resolved")
      throw new Error(`intervention ${id} is already resolved`);
    const ev = i.lease.grantToOperator(
      actor,
      `operator took control of ${i.stepId}`,
    );
    i.status = "operator_controlling";
    i.log?.event("control_transferred", { interventionId: id, ...ev });
    return this.view(i);
  }

  recordHumanAction(id: string, action: HumanAction): void {
    const i = this.items.get(id);
    if (!i) return;
    i.humanActions.push(action);
    // Verbose by design: what a human did to a banking session during an
    // automated run is exactly what an auditor will ask about later.
    i.log?.event("human_action", { interventionId: id, ...action });
  }

  /** Hand control back and unblock the parked run. */
  release(
    id: string,
    actor: string,
    decision: EscalationDecision,
  ): InterventionView {
    const i = this.require(id);
    const note = "note" in decision ? decision.note : "resuming automation";
    const ev = i.lease.returnToAutomation(actor, note);
    i.status = "resolved";
    i.log?.event("control_transferred", {
      interventionId: id,
      ...ev,
      decision: decision.action,
      humanActions: i.humanActions.length,
    });
    i.resolve(decision);
    return this.view(i);
  }

  private require(id: string): Intervention {
    const i = this.items.get(id);
    if (!i) throw new Error(`no such intervention: ${id}`);
    return i;
  }
}

export const interventions = new InterventionRegistry();
