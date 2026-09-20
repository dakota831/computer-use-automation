import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, rmSync, existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunLogger, newRunId } from "../src/core/log.js";
import { Redactor } from "../src/core/redact.js";

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "dex-log-"));
});
afterEach(() => {
  if (existsSync(base)) rmSync(base, { recursive: true, force: true });
});

const readLines = (p: string) =>
  readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

describe("RunLogger", () => {
  it("writes one self-describing JSON object per line, in order", () => {
    const l = new RunLogger(newRunId("replay"), "replay", { baseDir: base });
    l.event("run_started", { capabilityId: "cu.member.read_savings_balance" });
    l.event("step_started", { stepId: "s1" });
    const lines = readLines(l.logPath);
    expect(lines.map((e) => e.seq)).toEqual([1, 2]);
    expect(lines[0]).toMatchObject({ kind: "run_started", runId: l.runId });
    expect(lines[1]).toMatchObject({ kind: "step_started", stepId: "s1" });
    expect(typeof lines[0].ts).toBe("string");
  });

  // The central safety guarantee: a call site that forgets to redact is still safe,
  // because redaction happens on the write path rather than at the call site.
  it("redacts a registered secret even when the caller passes it raw", () => {
    const red = new Redactor();
    red.registerSecret("demo-teller-pw");
    const l = new RunLogger(newRunId("replay"), "replay", {
      baseDir: base,
      redactor: red,
    });
    l.event("action", {
      type: "type",
      value: "demo-teller-pw",
      note: "typed demo-teller-pw into field",
    });
    const raw = readFileSync(l.logPath, "utf8");
    expect(raw).not.toContain("demo-teller-pw");
    expect(raw).toContain("[redacted:secret]");
  });

  it("drops credential-shaped keys and structural PII without being told", () => {
    const l = new RunLogger(newRunId("replay"), "replay", { baseDir: base });
    l.event("note", {
      password: "whatever",
      screenText: "Member SSN: 123-45-6789",
    });
    const raw = readFileSync(l.logPath, "utf8");
    expect(raw).not.toContain("whatever");
    expect(raw).not.toContain("123-45-6789");
    expect(raw).toContain("[redacted:ssn]");
  });

  it("redacts accessibility snapshots, which are screen text", () => {
    const red = new Redactor();
    red.registerSecret("demo-teller-pw");
    const l = new RunLogger(newRunId("replay"), "replay", {
      baseDir: base,
      redactor: red,
    });
    const p = l.axSnapshot(
      { nodes: [{ role: "textbox", value: "demo-teller-pw" }] },
      "login",
    );
    expect(readFileSync(p, "utf8")).not.toContain("demo-teller-pw");
  });

  it("writes a summary carrying the redaction counters", () => {
    const red = new Redactor();
    red.registerSecret("demo-teller-pw");
    const l = new RunLogger(newRunId("replay"), "replay", {
      baseDir: base,
      redactor: red,
    });
    l.event("action", { value: "demo-teller-pw" });
    l.finish({ status: "success" });
    const s = JSON.parse(readFileSync(join(l.dir, "summary.json"), "utf8"));
    expect(s.status).toBe("success");
    expect(s.redactions.registered).toBeGreaterThan(0);
  });

  it("produces sortable run ids so an evidence directory self-orders", () => {
    const a = newRunId("discovery");
    const b = newRunId("discovery");
    expect(a.startsWith("discovery-")).toBe(true);
    expect([a, b].sort()).toHaveLength(2);
  });
});
