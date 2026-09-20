import { describe, it, expect, vi, afterEach } from "vitest";
import { NimClient, RateLimiter } from "../src/agent/llm.ts";

/**
 * The wall-clock budget has to be a bound, not a report.
 *
 * These exist because a real run blew straight through a 300s budget: the loop
 * only compared `Date.now()` to the deadline *between* steps, and one model
 * call took 108s with no request timeout of its own. With four retries on top,
 * the worst case for a single step was longer than the whole run was allowed.
 */

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const completion = {
  choices: [{ message: { content: "hi", tool_calls: [] } }],
  usage: {},
  model: "test",
};

const client = (over: Record<string, unknown> = {}) =>
  new NimClient({
    apiKey: "k",
    model: "m",
    minSpacingMs: 0,
    perMinute: 1000,
    ...over,
  });

afterEach(() => vi.restoreAllMocks());

describe("NimClient request bounds", () => {
  it("passes an abort signal to fetch", async () => {
    let seen: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => {
      seen = init;
      return ok(completion);
    });
    await client().chat({ messages: [] });
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("abandons a request that outlasts requestTimeoutMs", async () => {
    // A server that never answers - the shape that caused the original bug.
    vi.stubGlobal(
      "fetch",
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const t0 = Date.now();
    await expect(
      client({ requestTimeoutMs: 120, maxRetries: 4 }).chat({ messages: [] }),
    ).rejects.toThrow(/abandoned: no response within/);
    // It must not have walked the whole retry ladder.
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("never starts an attempt once the deadline has passed", async () => {
    const fetchSpy = vi.fn(async () => ok(completion));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      client().chat({ messages: [], deadline: Date.now() - 1 }),
    ).rejects.toThrow(/budget exhausted/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("caps the request timeout at the time the budget has left", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => {
      seen = init.signal as AbortSignal;
      return new Promise((_res, rej) => {
        setTimeout(() => _res(ok(completion)), 5_000);
        init.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      });
    });
    // 1.2s of budget left against a 60s per-request ceiling: the budget wins.
    const t0 = Date.now();
    await expect(
      client({ requestTimeoutMs: 60_000 }).chat({
        messages: [],
        deadline: Date.now() + 1_200,
      }),
    ).rejects.toThrow(/abandoned/);
    expect(seen?.aborted).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2_500);
  });

  it("does not start a request it has no time to act on", async () => {
    const fetchSpy = vi.fn(async () => ok(completion));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      client().chat({ messages: [], deadline: Date.now() + 200 }),
    ).rejects.toThrow(/budget exhausted/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stops retrying when the provider's Retry-After outlasts the budget", async () => {
    // A 429 with a minute of Retry-After, against a run with 30s left. Sleeping
    // through it would spend the whole budget waiting to do nothing.
    const fetchSpy = vi.fn(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "60" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      client().chat({ messages: [], deadline: Date.now() + 30_000 }),
    ).rejects.toThrow(/no budget left to retry/);
    // One attempt, then it gave up rather than sleeping through the budget.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("honours an operator cancel distinctly from a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      (_u: string, init: RequestInit) =>
        new Promise((_res, rej) => {
          init.signal?.addEventListener("abort", () =>
            rej(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    const ctl = new AbortController();
    setTimeout(() => ctl.abort(), 50);
    await expect(
      client({ requestTimeoutMs: 60_000 }).chat({
        messages: [],
        signal: ctl.signal,
      }),
    ).rejects.toThrow(/abandoned: cancelled/);
  });

  it("still returns a normal completion when nothing is wrong", async () => {
    vi.stubGlobal("fetch", async () => ok(completion));
    const r = await client().chat({
      messages: [],
      deadline: Date.now() + 60_000,
    });
    expect(r.content).toBe("hi");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

describe("RateLimiter", () => {
  it("spaces consecutive acquisitions by minSpacingMs", async () => {
    const l = new RateLimiter(1000, 60);
    await l.acquire();
    const t0 = Date.now();
    await l.acquire();
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45);
  });
});
