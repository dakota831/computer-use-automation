/**
 * The control lease.
 *
 * The brief asks for a real control-transfer model, so the central question is
 * "who is allowed to act on this session right now?" - and that has to have a
 * single authoritative answer, not an assumption held in two places.
 *
 * Exactly one party holds the lease at a time. Automation holds it by default.
 * When a human takes over, automation does not stop - it *parks*, awaiting the
 * lease. Killing the run would lose the session, which defeats the point: the
 * requirement is that the human operates the same live session and then hands it
 * back so the run can continue from where it stopped.
 *
 * Two properties worth being explicit about:
 *
 *  - The gate is enforced where the action happens, not where it is requested.
 *    A client that forgets to check is not a hole, because the server checks
 *    again immediately before dispatching anything into the page.
 *
 *  - Every transfer records who and why. "Who took control of this session"
 *    has to be answerable afterwards, or the audit trail is fiction.
 */

export type ControlOwner = "automation" | "operator";

export type LeaseEvent = {
  at: string;
  from: ControlOwner;
  to: ControlOwner;
  actor: string;
  reason: string;
};

export class ControlLease {
  private _owner: ControlOwner = "automation";
  private _holder = "automation";
  private waiters: (() => void)[] = [];
  readonly history: LeaseEvent[] = [];

  constructor(readonly sessionId: string) {}

  get owner(): ControlOwner {
    return this._owner;
  }
  get holder(): string {
    return this._holder;
  }

  private record(to: ControlOwner, actor: string, reason: string): LeaseEvent {
    const ev = {
      at: new Date().toISOString(),
      from: this._owner,
      to,
      actor,
      reason,
    };
    this.history.push(ev);
    return ev;
  }

  /** Hand the session to a named human. Idempotent for the same holder. */
  grantToOperator(actor: string, reason: string): LeaseEvent {
    if (this._owner === "operator" && this._holder === actor) {
      return this.history[this.history.length - 1]!;
    }
    const ev = this.record("operator", actor, reason);
    this._owner = "operator";
    this._holder = actor;
    return ev;
  }

  /**
   * Return control. Releases anything parked in `awaitAutomation`, which is how
   * a paused run resumes on the same session rather than starting a new one.
   */
  returnToAutomation(actor: string, reason: string): LeaseEvent {
    const ev = this.record("automation", actor, reason);
    this._owner = "automation";
    this._holder = "automation";
    const waiting = this.waiters;
    this.waiters = [];
    for (const w of waiting) w();
    return ev;
  }

  /** Park until automation holds the lease again. */
  awaitAutomation(): Promise<void> {
    if (this._owner === "automation") return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  /**
   * The enforcement point. Called immediately before anything is dispatched
   * into the live page, by both the automation path and the operator path.
   */
  assertHolder(who: ControlOwner): void {
    if (this._owner !== who) {
      throw new Error(
        `control is held by "${this._owner}" (${this._holder}); "${who}" may not act on this session`,
      );
    }
  }
}
