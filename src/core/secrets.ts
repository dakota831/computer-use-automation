import { readFileSync, existsSync } from "node:fs";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "node:crypto";

/**
 * Where the model API key comes from, and what that does and does not protect.
 *
 * An outbound API credential cannot be hashed. A hash is one-way; NVIDIA needs
 * the actual bytes to authenticate the request, so anything this process can
 * send, this process can also read. Any claim to the contrary would be theatre.
 * What is achievable is bounded, and worth being precise about:
 *
 *   Accidental commit to a public repo — the real risk, and the one that has
 *     actually happened to people. Handled by .gitignore, by `npm run
 *     secret-scan` in `npm run check`, and by a pre-commit hook. Belt and two
 *     braces, because this one is unrecoverable once pushed.
 *   Reading it out of the process or its logs — the key is registered with the
 *     redactor at startup, so it is masked on the logger's write path before
 *     anything reaches disk, and it is never placed in the model context.
 *   Copying the file off the host — handled here. A sealed key is encrypted
 *     with a key derived from this machine's /etc/machine-id, so the file is
 *     inert on any other machine.
 *
 * What is NOT protected: anyone who can already run code as this user on this
 * host can decrypt it, because the service must be able to. Sealing raises the
 * cost of exfiltrating a file; it does not defend against local compromise, and
 * it is not a substitute for rotating a key that has been disclosed. Real
 * deployments should hand this to a KMS or to systemd's LoadCredential (which
 * needs systemd 250; this host runs 249) and this module is the seam where
 * that would slot in.
 */

const ALGO = "aes-256-gcm";

/** A key that exists only on this machine. Copying the ciphertext gains nothing. */
function hostKey(salt: Buffer): Buffer {
  const machineId = readFileSync("/etc/machine-id", "utf8").trim();
  return scryptSync(machineId, salt, 32);
}

/** Seal a plaintext value for storage next to the code. */
export function seal(plaintext: string, saltHex: string): string {
  const salt = Buffer.from(saltHex, "hex");
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, hostKey(salt), iv);
  const enc = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  // Separator is ".", which base64url never produces - and the magic must
  // not contain one either, or the fields shift by one.
  return [
    "dexseal-v1",
    salt.toString("base64url"),
    iv.toString("base64url"),
    c.getAuthTag().toString("base64url"),
    enc.toString("base64url"),
  ].join(".");
}

function unseal(blob: string): string {
  const [magic, saltB, ivB, tagB, dataB] = blob.trim().split(".");
  if (magic !== "dexseal-v1")
    throw new Error("sealed secret: unrecognised format");
  const d = createDecipheriv(
    ALGO,
    hostKey(Buffer.from(saltB!, "base64url")),
    Buffer.from(ivB!, "base64url"),
  );
  d.setAuthTag(Buffer.from(tagB!, "base64url"));
  return Buffer.concat([
    d.update(Buffer.from(dataB!, "base64url")),
    d.final(),
  ]).toString("utf8");
}

/**
 * The model API key, or undefined when none is configured.
 *
 * Order matters: an explicit environment variable wins, because that is how a
 * container, a CI job or a KMS sidecar would inject it and none of them should
 * have to know about this file format.
 */
export function modelApiKey(): string | undefined {
  const fromEnv = process.env.NVIDIA_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const path =
    process.env.DEX_SEALED_KEY_FILE ?? "secrets/nvidia-api-key.sealed";
  if (!existsSync(path)) return undefined;
  try {
    return unseal(readFileSync(path, "utf8"));
  } catch (e) {
    // Fail loudly. A silently missing key turns into "discovery is not
    // configured" three layers away, which is a miserable thing to debug.
    throw new Error(
      `could not open the sealed key at ${path}: ${String(e).slice(0, 120)}. ` +
        `A sealed key is bound to the machine that sealed it — re-seal it with ` +
        `\`npm run seal-key\` if this host changed.`,
    );
  }
}

/** A stable, non-reversible label for a key, safe to print. */
export const keyFingerprint = (key: string): string =>
  createHash("sha256").update(key).digest("hex").slice(0, 12);
