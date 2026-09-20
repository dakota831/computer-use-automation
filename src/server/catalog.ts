import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Capability } from "../core/artifact.js";

/**
 * The capability catalog: saved artifacts as a set of callable tools.
 *
 * This is the point of the whole system from the calling agent's side. A
 * capability already declares typed inputs, typed outputs and a description, so
 * a tool definition is a projection of the contract rather than a second thing
 * to maintain. Nothing here is hand-written per capability - add an artifact to
 * the directory and it becomes invocable.
 *
 * The JSON Schema is generated from the same ParamSpec the replay engine
 * validates against, so an agent that satisfies the schema cannot then fail
 * input validation. One source of truth, two consumers.
 */

export type CatalogEntry = { capability: Capability; path: string };

export class Catalog {
  private entries = new Map<string, CatalogEntry>();

  constructor(private readonly dir = "artifacts") {}

  load(): this {
    this.entries.clear();
    let files: string[] = [];
    try {
      files = readdirSync(this.dir).filter((f) => f.endsWith(".json"));
    } catch {
      return this;
    }
    for (const f of files) {
      try {
        const capability = Capability.parse(
          JSON.parse(readFileSync(join(this.dir, f), "utf8")),
        );
        this.entries.set(`${capability.id}@${capability.version}`, {
          capability,
          path: join(this.dir, f),
        });
      } catch {
        // A malformed artifact is skipped rather than taking the catalog down.
        // It is also not silently "fine" - it simply is not offered as callable.
      }
    }
    return this;
  }

  list(): Capability[] {
    return [...this.entries.values()].map((e) => e.capability);
  }

  /** Latest version of a capability id, or an exact `id@version`. */
  find(ref: string): CatalogEntry | undefined {
    if (this.entries.has(ref)) return this.entries.get(ref);
    const matches = [...this.entries.values()]
      .filter((e) => e.capability.id === ref)
      .sort((a, b) => b.capability.version.localeCompare(a.capability.version));
    return matches[0];
  }

  summaries() {
    return this.list().map((c) => ({
      id: c.id,
      version: c.version,
      title: c.title,
      description: c.description,
      status: c.status,
      tenant: c.tenant,
      vendorApp: c.surface.appProfile.vendorApp,
      steps: c.steps.length,
      inputs: c.inputs.map((i) => ({
        name: i.name,
        type: i.type,
        required: i.required,
        description: i.description,
      })),
      outputs: c.outputs.map((o) => ({
        name: o.name,
        type: o.type,
        description: o.description,
      })),
      outcomes: [...c.steps.flatMap((s) => s.outcomes), ...c.outcomes].map(
        (o) => ({
          code: o.code,
          disposition: o.disposition,
          describedAs: o.describedAs,
        }),
      ),
    }));
  }

  /**
   * Tool definitions in the shape a function-calling agent expects.
   *
   * Only `approved` capabilities are offered for unattended invocation - the
   * catalog is where the draft gate becomes visible to the caller rather than
   * being a surprise at execution time.
   */
  toolDefinitions(opts: { includeDrafts?: boolean } = {}) {
    return this.list()
      .filter((c) =>
        opts.includeDrafts
          ? c.status !== "deprecated"
          : c.status === "approved",
      )
      .map((c) => ({
        type: "function" as const,
        function: {
          name: c.id.replace(/\./g, "_"),
          description: `${c.description} Returns: ${c.outputs.map((o) => `${o.name} (${o.type})`).join(", ") || "nothing"}. Known outcomes: ${
            [...c.steps.flatMap((s) => s.outcomes), ...c.outcomes]
              .map((o) => o.code)
              .join(", ") || "none declared"
          }.`,
          parameters: {
            type: "object",
            properties: Object.fromEntries(
              c.inputs.map((i) => [
                i.name,
                {
                  type: i.type === "date" ? "string" : i.type,
                  description: i.description,
                  ...(i.pattern ? { pattern: i.pattern } : {}),
                  ...(i.enum ? { enum: i.enum } : {}),
                },
              ]),
            ),
            required: c.inputs.filter((i) => i.required).map((i) => i.name),
            additionalProperties: false,
          },
        },
      }));
  }
}
