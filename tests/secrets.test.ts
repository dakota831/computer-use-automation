import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { seal, keyFingerprint } from "../src/core/secrets.ts";
import { redactor } from "../src/core/redact.ts";

/**
 * Sealing is deliberately modest: it stops a copied file being useful
 * elsewhere. These assert the properties actually claimed, not more.
 */
const salt = () => randomBytes(16).toString("hex");

// A deliberately fake credential, shaped like a real one so the redaction and
// sealing assertions are meaningful. secret-scan-allow
const FAKE_KEY = "nvapi-" + "SuperSecretValue123456";

describe("sealed secrets", () => {
  it("does not contain the plaintext", () => {
    const blob = seal(FAKE_KEY, salt());
    expect(blob).not.toContain("SuperSecretValue");
    expect(blob).not.toContain("nvapi-");
  });

  it("is tamper-evident", async () => {
    const blob = seal("nvapi-value", salt());
    const parts = blob.split(".");
    // Flip a byte of the ciphertext; GCM's tag must reject it.
    const data = Buffer.from(parts[4]!, "base64url");
    data[0] = (data[0] ?? 0) ^ 0xff;
    parts[4] = data.toString("base64url");
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const f = join(mkdtempSync(join(tmpdir(), "dex-")), "k.sealed");
    writeFileSync(f, parts.join("."));
    process.env.DEX_SEALED_KEY_FILE = f;
    const saved = process.env.NVIDIA_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    const { modelApiKey } = await import("../src/core/secrets.ts");
    expect(() => modelApiKey()).toThrow(/could not open the sealed key/);
    if (saved !== undefined) process.env.NVIDIA_API_KEY = saved;
    delete process.env.DEX_SEALED_KEY_FILE;
  });

  it("produces a different blob each time for the same input", () => {
    // A deterministic ciphertext would leak that two hosts share a key.
    expect(seal("same", salt())).not.toBe(seal("same", salt()));
  });

  it("fingerprints without revealing", () => {
    const fp = keyFingerprint(FAKE_KEY);
    expect(fp).toHaveLength(12);
    expect(fp).not.toContain("Secret");
    expect(keyFingerprint(FAKE_KEY)).toBe(fp);
    expect(keyFingerprint("nvapi-different")).not.toBe(fp);
  });

  it("is redacted if it ever reaches a log", () => {
    // Belt and braces: sealing protects the file, redaction protects the log.
    redactor.registerSecret(FAKE_KEY);
    expect(redactor.text("key=" + FAKE_KEY)).not.toContain("SuperSecret");
  });
});
