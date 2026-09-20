import type { ParamSpec } from "./artifact.js";
import { ReplayFailure } from "./errors.js";

/**
 * Value templating for recorded steps.
 *
 * Two forms, and the distinction is a security boundary rather than a convenience:
 *
 *   {{memberId}}            - an input the caller supplied
 *   {{secret:app.password}} - resolved from the secret provider at act time
 *
 * A secret reference is what gets recorded in the artifact; the value never is.
 * That means an artifact can be committed, reviewed and shared without carrying
 * a credential, and the model driving discovery never sees one either - it emits
 * the reference, and the executor substitutes at the moment of typing.
 */

export type SecretProvider = (key: string) => string | undefined;

const TOKEN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.:]*)\s*\}\}/g;

export function resolveTemplate(
  template: string,
  inputs: Record<string, unknown>,
  secrets?: SecretProvider,
): string {
  return template.replace(TOKEN, (_m, token: string) => {
    if (token.startsWith("secret:")) {
      const key = token.slice("secret:".length);
      const v = secrets?.(key);
      if (v === undefined) {
        throw new ReplayFailure({
          code: "INPUT_INVALID",
          message: `no value configured for secret "${key}"`,
        });
      }
      return v;
    }
    const v = inputs[token];
    if (v === undefined || v === null) {
      throw new ReplayFailure({
        code: "INPUT_INVALID",
        message: `template references "${token}", which was not supplied`,
      });
    }
    return String(v);
  });
}

/** True when a template contains a secret reference; used to suppress logging of the result. */
export const containsSecret = (template: string): boolean =>
  /\{\{\s*secret:/.test(template);

/**
 * Validate caller-supplied inputs against the capability's declared parameters,
 * before the browser is launched. Failing here costs nothing; failing three
 * steps into a flow costs a partially-mutated record.
 */
export function validateInputs(
  specs: ParamSpec[],
  inputs: Record<string, unknown>,
):
  | { ok: true; coerced: Record<string, unknown> }
  | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const coerced: Record<string, unknown> = {};

  for (const spec of specs) {
    const raw = inputs[spec.name];
    if (raw === undefined || raw === null || raw === "") {
      if (spec.required) errors.push(`missing required input "${spec.name}"`);
      continue;
    }
    const s = String(raw);

    switch (spec.type) {
      case "number": {
        const n = Number(s.replace(/[$,]/g, ""));
        if (!Number.isFinite(n)) errors.push(`"${spec.name}" must be a number`);
        else coerced[spec.name] = n;
        break;
      }
      case "boolean":
        coerced[spec.name] = s === "true" || s === "1";
        break;
      case "date":
        if (Number.isNaN(Date.parse(s)))
          errors.push(`"${spec.name}" must be a date`);
        else coerced[spec.name] = s;
        break;
      default:
        coerced[spec.name] = s;
    }

    if (spec.pattern && !new RegExp(spec.pattern).test(s)) {
      errors.push(
        `"${spec.name}" does not match required pattern ${spec.pattern}`,
      );
    }
    if (spec.enum && !spec.enum.includes(s)) {
      errors.push(`"${spec.name}" must be one of: ${spec.enum.join(", ")}`);
    }
  }

  // Unknown inputs are rejected rather than ignored: a caller passing memberID
  // when the contract says memberId should be told, not silently given a run
  // with a missing value.
  for (const key of Object.keys(inputs)) {
    if (!specs.some((s) => s.name === key))
      errors.push(`unknown input "${key}"`);
  }

  return errors.length ? { ok: false, errors } : { ok: true, coerced };
}
