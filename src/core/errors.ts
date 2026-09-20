/**
 * The error taxonomy.
 *
 * This is the load-bearing abstraction of the whole system, so it is defined
 * before anything that uses it. The brief is blunt that conflating a business
 * outcome with a failure is the most common design mistake in this problem, so
 * the types here make that conflation impossible to express: a business outcome
 * is not an Error subclass and cannot be thrown.
 *
 * Four dispositions, and every condition the replay engine meets is exactly one:
 *
 *   ok               the step did what it was supposed to do
 *   business outcome the application gave a legitimate answer the caller needs.
 *                    "No such member" is the canonical case. The run stops, the
 *                    caller is told, and nothing went wrong.
 *   recoverable      a known runtime condition we can handle ourselves: dismiss
 *                    a known interstitial, wait out a slow load, re-authenticate
 *                    an expired session. Bounded by attempts, never open-ended.
 *   hard failure     we cannot proceed and a human could not fix it by clicking.
 *                    Stops the run and surfaces what step, what was expected,
 *                    and what was actually observed.
 *
 * Escalation is deliberately NOT a fifth kind. It is a *response* to a hard
 * failure or to a risky step, decided by policy — which keeps "what happened"
 * separate from "what we chose to do about it".
 */

/** Machine-readable cause of a hard failure. Stable; callers may switch on it. */
export type FailureCode =
  /** No element matched any recorded strategy for a target. */
  | "TARGET_NOT_FOUND"
  /** More than one element matched and the descriptor forbids guessing. */
  | "TARGET_AMBIGUOUS"
  /** The action ran but the world did not end up in the expected state. */
  | "CHECKPOINT_FAILED"
  /** The action was refused before it ran: outside the allowlist, or too risky. */
  | "POLICY_VIOLATION"
  /** Supplied inputs did not satisfy the capability's declared parameters. */
  | "INPUT_INVALID"
  /** A wait budget elapsed without the condition becoming true. */
  | "TIMEOUT"
  /** The surface itself broke: browser crash, frame detached, navigation error. */
  | "SURFACE_ERROR"
  /** The target application reported its own error (an HTTP 500-class screen). */
  | "APP_ERROR"
  /** A recoverable condition kept recurring past its attempt budget. */
  | "RECOVERY_EXHAUSTED"
  /** Escalated to a human, and no human resolved it within the window. */
  | "ESCALATION_UNRESOLVED"
  /** The capability is not approved for the mode it was invoked in. */
  | "NOT_APPROVED";

/** Pointers to richer evidence written to disk. Paths, never inline blobs. */
export type EvidenceRefs = {
  screenshotPath?: string;
  axSnapshotPath?: string;
  htmlPath?: string;
  logPath?: string;
};

/**
 * A hard failure. Carries enough to debug without re-running: which step, what
 * we expected, what we actually saw, and where the richer evidence landed.
 */
export class ReplayFailure extends Error {
  readonly code: FailureCode;
  readonly stepId?: string;
  readonly expected?: string;
  readonly observed?: string;
  readonly evidence: EvidenceRefs;
  /** True when retrying the same step might plausibly work (transient surface faults). */
  readonly retryable: boolean;

  constructor(args: {
    code: FailureCode;
    message: string;
    stepId?: string;
    expected?: string;
    observed?: string;
    evidence?: EvidenceRefs;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(args.message, { cause: args.cause });
    this.name = "ReplayFailure";
    this.code = args.code;
    this.stepId = args.stepId;
    this.expected = args.expected;
    this.observed = args.observed;
    this.evidence = args.evidence ?? {};
    this.retryable = args.retryable ?? false;
  }

  /** Structured form for logs and API responses. Never includes raw screen text. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      stepId: this.stepId,
      expected: this.expected,
      observed: this.observed,
      evidence: this.evidence,
      retryable: this.retryable,
    };
  }
}

/**
 * A legitimate application answer. Not an Error, and deliberately not throwable —
 * the type system should not let someone `throw` a "member not found".
 */
export type BusinessOutcome = {
  code: string;
  message: string;
  /** Any values the capability managed to extract before stopping. */
  data?: Record<string, unknown>;
};

/**
 * What a whole replay produced. This is the contract a calling agent programs
 * against, so the four arms are exhaustive and mutually exclusive.
 */
export type ReplayResult =
  | {
      status: "success";
      capabilityId: string;
      version: string;
      runId: string;
      outputs: Record<string, unknown>;
      durationMs: number;
      evidence: EvidenceRefs;
    }
  | {
      status: "outcome";
      capabilityId: string;
      version: string;
      runId: string;
      outcome: BusinessOutcome;
      durationMs: number;
      evidence: EvidenceRefs;
    }
  | {
      status: "escalated";
      capabilityId: string;
      version: string;
      runId: string;
      interventionId: string;
      /** Set once a human closed it out; absent while still pending. */
      resolution?: "resumed" | "completed_by_human" | "abandoned";
      evidence: EvidenceRefs;
    }
  | {
      status: "failed";
      capabilityId: string;
      version: string;
      runId: string;
      failure: ReturnType<ReplayFailure["toJSON"]>;
      durationMs: number;
      evidence: EvidenceRefs;
    };

/**
 * Raised during discovery, not replay. Kept separate because the discovery loop
 * is allowed to flail and retry in ways replay never is.
 */
export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "max_steps"
      | "dead_end"
      | "policy_violation"
      | "model_error"
      | "timeout"
      | "cancelled",
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}
