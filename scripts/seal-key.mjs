import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { seal } from "../src/core/secrets.ts";

/**
 * Seal a credential to this machine.
 *
 * Read from stdin rather than argv so the value never lands in shell history
 * or in the process list, both of which are readable by other users.
 */
const rl = createInterface({ input: process.stdin, output: process.stderr });
const value = (
  await rl.question("value to seal (input is not echoed to stdout): ")
).trim();
rl.close();
if (!value) {
  console.error("nothing to seal");
  process.exit(1);
}
const out = process.argv[2] ?? "secrets/nvidia-api-key.sealed";
mkdirSync("secrets", { recursive: true });
writeFileSync(out, seal(value, randomBytes(16).toString("hex")) + "\n", "utf8");
chmodSync(out, 0o600);
console.error(
  `sealed to ${out} — bound to this machine, inert if copied elsewhere`,
);
