import type { Sensitivity } from "./artifact.js";

/**
 * Redaction.
 *
 * The rule from the brief is absolute: never persist secrets or raw sensitive
 * data into artifacts or logs. The design principle here is that redaction is
 * applied on the *write path*, inside the logger and the evidence writer, not
 * left to the discipline of each call site. A call site that forgets is the
 * normal case, so forgetting must be safe.
 *
 * Two independent mechanisms, because either alone is insufficient:
 *
 *   1. Registered values. Anything the system knows to be a secret - a password
 *      resolved from the vault, the model API key - is registered here and
 *      scrubbed from every string written anywhere, including screen text
 *      scraped off the page. This catches a password echoed back in a form
 *      value or an error message, which pattern matching would never spot.
 *
 *   2. Patterns. Structural detection of regulated data (SSN, card, long account
 *      numbers) for values the system was never told about, because screen text
 *      from a member record is full of data nobody declared.
 *
 * Declared field sensitivity (from the capability's ParamSpec/OutputSpec) is the
 * third input, applied by callers who know which field they are handling.
 */

const MIN_SECRET_LEN = 6; // below this, scrubbing does more harm than good

export type RedactionCounters = Record<string, number>;

/** Luhn check, to keep 16-digit reference numbers from being mistaken for cards. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

type Pattern = { name: string; re: RegExp; replace: (m: string) => string };

const PATTERNS: Pattern[] = [
  {
    name: "ssn",
    re: /\b\d{3}-\d{2}-\d{4}\b/g,
    replace: () => "[redacted:ssn]",
  },
  {
    // Candidate card numbers, confirmed with Luhn before redacting.
    name: "card",
    re: /\b(?:\d[ -]?){13,19}\b/g,
    replace: (m) => (luhnValid(m.replace(/[ -]/g, "")) ? "[redacted:card]" : m),
  },
  {
    name: "api_key",
    re: /\b(?:nvapi|sk|gho|ghp|xox[baprs])-[A-Za-z0-9_-]{8,}\b/g,
    replace: () => "[redacted:api_key]",
  },
  {
    name: "bearer",
    re: /\bBearer\s+[A-Za-z0-9._-]{12,}/gi,
    replace: () => "Bearer [redacted]",
  },
  {
    name: "email",
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: () => "[redacted:email]",
  },
];

export class Redactor {
  /** Exact values to scrub from every string, longest first so overlaps resolve correctly. */
  private secrets: string[] = [];
  readonly counters: RedactionCounters = {};

  private bump(name: string, n = 1) {
    this.counters[name] = (this.counters[name] ?? 0) + n;
  }

  /**
   * Register a literal value that must never appear in output.
   * Safe to call with undefined/short values; they are ignored rather than
   * causing every occurrence of a common substring to be mangled.
   */
  registerSecret(value: string | undefined | null): void {
    if (!value || value.length < MIN_SECRET_LEN) return;
    if (this.secrets.includes(value)) return;
    this.secrets.push(value);
    this.secrets.sort((a, b) => b.length - a.length);
  }

  /** Scrub a single string: registered values first, then structural patterns. */
  text(input: string): string {
    let out = input;
    for (const s of this.secrets) {
      if (out.includes(s)) {
        this.bump("registered", out.split(s).length - 1);
        out = out.split(s).join("[redacted:secret]");
      }
    }
    for (const p of PATTERNS) {
      out = out.replace(p.re, (m) => {
        const r = p.replace(m);
        if (r !== m) this.bump(p.name);
        return r;
      });
    }
    return out;
  }

  /**
   * Apply a field's declared sensitivity.
   *
   * `pii` keeps the shape (type and length) because that is genuinely useful when
   * debugging a run - "we typed a 6-character string into the member field" -
   * while revealing nothing. `secret` keeps nothing at all, not even length,
   * because length leaks information about a password.
   */
  field(value: unknown, sensitivity: Sensitivity): unknown {
    switch (sensitivity) {
      case "secret":
        this.bump("field_secret");
        return "[secret]";
      case "pii": {
        this.bump("field_pii");
        if (value === null || value === undefined) return value;
        const s = String(value);
        return `[pii:${typeof value}:${s.length}]`;
      }
      case "internal":
      case "public":
      default:
        return typeof value === "string" ? this.text(value) : value;
    }
  }

  /** Deep-scrub an arbitrary structure on its way to a log or an evidence file. */
  deep<T>(value: T): T {
    return this.walk(value, 0) as T;
  }

  private walk(v: unknown, depth: number): unknown {
    if (depth > 12) return "[redacted:too-deep]";
    if (typeof v === "string") return this.text(v);
    if (Array.isArray(v)) return v.map((x) => this.walk(x, depth + 1));
    if (v && typeof v === "object") {
      if (v instanceof Error) return this.text(`${v.name}: ${v.message}`);
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        // Keys that conventionally hold credentials are dropped wholesale rather
        // than pattern-matched, because their values are often unstructured.
        out[k] = /pass(word)?|secret|token|api_?key|authorization|cookie/i.test(
          k,
        )
          ? (this.bump("field_by_key"), "[redacted]")
          : this.walk(val, depth + 1);
      }
      return out;
    }
    return v;
  }
}

/** Process-wide instance. The API key is registered at startup by the config loader. */
export const redactor = new Redactor();
