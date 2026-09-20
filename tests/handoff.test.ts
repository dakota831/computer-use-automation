import { describe, it, expect } from "vitest";
import { ControlLease } from "../src/server/lease.js";
import { InterventionRegistry } from "../src/server/interventions.js";

/** Minimal stand-ins: the control-transfer model does not depend on a real browser. */
/**
 * What a caller passes to `raise`.
 *
 * This used to fake a whole EscalationContext with three `as any` casts,
 * because the registry took one. It reads the eight fields below and nothing
 * else, so it now asks for those - and the fixture needs no casts at all.
 */
const ctx = () => ({
  runId: "run-1",
  capabilityId: "cu.test",
  goal: "Test capability",
  stepId: "s9_confirm",
  stepIntent: "Submit the form",
  reason: 'step is classified "irreversible"',
  url: "http://app/t/x",
});

const surface = {} as any;

describe("ControlLease", () => {
  it("starts with automation holding it", () => {
    const l = new ControlLease("s1");
    expect(l.owner).toBe("automation");
    expect(() => l.assertHolder("automation")).not.toThrow();
    expect(() => l.assertHolder("operator")).toThrow(/held by "automation"/);
  });

  it("transfers to a named operator and back, recording both", () => {
    const l = new ControlLease("s1");
    l.grantToOperator("dakota@ops", "took control of s9");
    expect(l.owner).toBe("operator");
    expect(l.holder).toBe("dakota@ops");
    expect(() => l.assertHolder("automation")).toThrow();

    l.returnToAutomation("dakota@ops", "approved");
    expect(l.owner).toBe("automation");
    expect(l.history.map((h) => `${h.from}->${h.to}`)).toEqual([
      "automation->operator",
      "operator->automation",
    ]);
    expect(l.history.every((h) => h.actor && h.reason)).toBe(true);
  });

  // The core of the model: automation parks rather than dying, so the session
  // survives the handoff and the run can continue on it.
  it("parks automation until control comes back", async () => {
    const l = new ControlLease("s1");
    l.grantToOperator("op", "taking over");

    let resumed = false;
    const parked = l.awaitAutomation().then(() => (resumed = true));

    await new Promise((r) => setTimeout(r, 30));
    expect(resumed).toBe(false); // still parked

    l.returnToAutomation("op", "done");
    await parked;
    expect(resumed).toBe(true);
  });

  it("resolves immediately when automation already holds it", async () => {
    await expect(
      new ControlLease("s1").awaitAutomation(),
    ).resolves.toBeUndefined();
  });

  it("is idempotent for the same holder", () => {
    const l = new ControlLease("s1");
    l.grantToOperator("op", "first");
    l.grantToOperator("op", "again");
    expect(l.history).toHaveLength(1);
  });
});

describe("InterventionRegistry", () => {
  it("raises, takes, and resolves with the decision the operator made", async () => {
    const reg = new InterventionRegistry();
    const lease = new ControlLease("s1");
    const { intervention, decided } = reg.raise({
      ...ctx(),
      surface,
      lease,
      version: "1.0.0",
    });

    expect(reg.list()).toHaveLength(1);
    expect(intervention.status).toBe("pending");

    reg.take(intervention.id, "dakota@ops");
    expect(reg.view(reg.get(intervention.id)!).status).toBe(
      "operator_controlling",
    );
    expect(lease.owner).toBe("operator");

    reg.release(intervention.id, "dakota@ops", { action: "resume" });
    await expect(decided).resolves.toEqual({ action: "resume" });
    expect(lease.owner).toBe("automation");
  });

  it("distinguishes approving a step from performing it", async () => {
    const reg = new InterventionRegistry();
    const { intervention, decided } = reg.raise({
      ...ctx(),
      surface,
      lease: new ControlLease("s"),
      version: "1.0.0",
    });
    reg.take(intervention.id, "op");
    reg.release(intervention.id, "op", {
      action: "step_completed",
      note: "did it by hand",
    });
    await expect(decided).resolves.toMatchObject({ action: "step_completed" });
  });

  it("records operator actions for the audit trail", () => {
    const reg = new InterventionRegistry();
    const { intervention } = reg.raise({
      ...ctx(),
      surface,
      lease: new ControlLease("s"),
      version: "1.0.0",
    });
    reg.recordHumanAction(intervention.id, {
      at: new Date().toISOString(),
      kind: "click",
      detail: { x: 10, y: 20 },
    });
    expect(reg.view(reg.get(intervention.id)!).humanActions).toHaveLength(1);
  });

  /**
   * Found by leaving an intervention open during testing: an unanswered
   * escalation held a live browser session indefinitely. An escalation nobody
   * answers is a real operational state and needs a bounded outcome.
   */
  it("abandons an escalation that no one answers", async () => {
    const reg = new InterventionRegistry();
    const lease = new ControlLease("s1");
    const { intervention, decided } = reg.raise({
      ...ctx(),
      surface,
      lease,
      version: "1.0.0",
      timeoutMs: 60,
    });

    const decision = await decided;
    expect(decision).toMatchObject({ action: "abandon" });
    expect(decision).toHaveProperty(
      "note",
      expect.stringContaining("no operator responded"),
    );
    expect(reg.get(intervention.id)!.timedOut).toBe(true);
    // The lease must come back, or the parked run would never unblock.
    expect(lease.owner).toBe("automation");
  });

  it("cancels the abandon timer once a human resolves it", async () => {
    const reg = new InterventionRegistry();
    const { intervention, decided } = reg.raise({
      ...ctx(),
      surface,
      lease: new ControlLease("s"),
      version: "1.0.0",
      timeoutMs: 60,
    });
    reg.take(intervention.id, "op");
    reg.release(intervention.id, "op", { action: "resume" });
    await expect(decided).resolves.toEqual({ action: "resume" });
    await new Promise((r) => setTimeout(r, 120));
    expect(reg.get(intervention.id)!.timedOut).toBeUndefined();
  });

  it("refuses to resolve an unknown intervention", () => {
    expect(() => new InterventionRegistry().take("nope", "op")).toThrow(
      /no such intervention/,
    );
  });
});
