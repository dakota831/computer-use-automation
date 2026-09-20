import { describe, it, expect } from "vitest";
import { Redactor } from "../src/core/redact.js";

describe("Redactor", () => {
  it("scrubs a registered secret everywhere it appears, including screen text", () => {
    const r = new Redactor();
    r.registerSecret("demo-teller-pw");
    const screen = 'Login failed for password "demo-teller-pw" (attempt 1)';
    expect(r.text(screen)).not.toContain("demo-teller-pw");
    expect(r.text(screen)).toContain("[redacted:secret]");
  });

  it("ignores short values rather than mangling common substrings", () => {
    const r = new Redactor();
    r.registerSecret("abc");
    expect(r.text("abc def abcdef")).toBe("abc def abcdef");
  });

  it("redacts SSNs", () => {
    const r = new Redactor();
    expect(r.text("SSN: 123-45-6789")).toBe("SSN: [redacted:ssn]");
  });

  it("redacts real card numbers but leaves non-Luhn reference numbers alone", () => {
    const r = new Redactor();
    expect(r.text("card 4111 1111 1111 1111")).toContain("[redacted:card]");
    // A 16-digit internal reference that fails Luhn must survive - over-redaction
    // destroys the debuggability the evidence exists to provide.
    expect(r.text("ref 1234567890123456")).toBe("ref 1234567890123456");
  });

  it("redacts API keys of the shapes this project actually handles", () => {
    const r = new Redactor();
    expect(r.text("NVIDIA_API_KEY=nvapi-AbCd1234EfGh5678")).toContain(
      "[redacted:api_key]",
    );
    expect(r.text("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")).toContain(
      "Bearer [redacted]",
    );
  });

  it("keeps shape for pii but reveals nothing for secrets", () => {
    const r = new Redactor();
    expect(r.field("100001", "pii")).toBe("[pii:string:6]");
    expect(r.field("hunter2xyz", "secret")).toBe("[secret]");
    expect(r.field("Member Search", "public")).toBe("Member Search");
  });

  it("drops credential-shaped keys wholesale, whatever the value looks like", () => {
    const r = new Redactor();
    const out = r.deep({
      user: "teller1",
      password: "anything at all",
      nested: { apiKey: "xyz" },
    }) as any;
    expect(out.user).toBe("teller1");
    expect(out.password).toBe("[redacted]");
    expect(out.nested.apiKey).toBe("[redacted]");
  });

  it("walks arrays and nested objects", () => {
    const r = new Redactor();
    r.registerSecret("demo-teller-pw");
    const out = r.deep({ steps: [{ note: "typed demo-teller-pw" }] }) as any;
    expect(out.steps[0].note).toContain("[redacted:secret]");
  });

  it("terminates on cyclic-ish deep structures instead of blowing the stack", () => {
    const r = new Redactor();
    let deep: any = "leaf";
    for (let i = 0; i < 40; i++) deep = { next: deep };
    expect(() => r.deep(deep)).not.toThrow();
  });
});
