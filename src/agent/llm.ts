/**
 * Model client for NVIDIA NIM.
 *
 * Written against the OpenAI-compatible surface NVIDIA exposes rather than a
 * vendor SDK, so provider and model are configuration rather than code. That is
 * not hypothetical tidiness: free-tier models vary a great deal in tool-calling
 * reliability, and being able to swap one for another without touching the agent
 * loop is what makes that survivable.
 *
 * Measured tool-calling latency across the four candidates, single samples
 * against an identical prompt:
 *
 *   openai/gpt-oss-20b          775ms
 *   z-ai/glm-5.3                14.0s     <- default
 *   z-ai/glm-5.3-flash          42.1s
 *   moonshotai/kimi-k3          120.4s
 *
 * All four emitted a correct tool call on that prompt, and speed originally
 * picked the fastest. Running real goals against both changed the answer.
 *
 * On a short lookup the two are equivalent. On a longer goal - sign in, find a
 * member, post a fee to one of their accounts, read back two values -
 * gpt-oss-20b took 18 recorded steps across 23 model calls, wandering into the
 * account register and back, and baked a mangled account number into the
 * artifact as a literal. glm-5.3 did the same goal in 10 steps and 13 calls,
 * with intents a reviewer can read. The slower model is cheaper overall once
 * the wasted steps and the review they cost are counted, and the artifact it
 * produces is the thing that has to last.
 */

/**
 * The default model, in one place.
 *
 * It was previously repeated as a literal in four call sites, which is three
 * more opportunities than necessary for them to disagree.
 */
export const DEFAULT_MODEL = "z-ai/glm-5.3";

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content?: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model: string;
  latencyMs: number;
};

/**
 * Rate limiting is enforced inside the client, not left to callers.
 *
 * Two constraints, because one alone is not enough. A rolling window caps
 * throughput over a minute, and a minimum spacing stops a burst of requests
 * going out back-to-back at the start of that window - which is what actually
 * trips provider limits and is exactly the shape an agent loop produces.
 */
export class RateLimiter {
  private readonly times: number[] = [];
  private last = 0;

  constructor(
    private readonly perMinute: number,
    private readonly minSpacingMs: number,
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now();
      while (this.times.length && now - this.times[0]! > 60_000)
        this.times.shift();

      const sinceLast = now - this.last;
      const spacingWait = Math.max(0, this.minSpacingMs - sinceLast);
      const windowWait =
        this.times.length >= this.perMinute
          ? Math.max(0, 60_000 - (now - this.times[0]!) + 50)
          : 0;
      const wait = Math.max(spacingWait, windowWait);

      if (wait === 0) {
        this.last = Date.now();
        this.times.push(this.last);
        return;
      }
      await sleep(wait);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A failure that retrying cannot help: the budget is gone, or we were asked to
 * stop. It needs to be a distinct type because the retry loop's catch arm is
 * otherwise indiscriminate - throwing a plain Error to escape the ladder just
 * lands one rung further down it, which is exactly the bug this class fixes.
 */
class NonRetryable extends Error {}

export type NimOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  perMinute?: number;
  minSpacingMs?: number;
  maxRetries?: number;
  /**
   * Ceiling on a single HTTP request, independent of any overall budget.
   *
   * Without this a fetch inherits undici's 300s header timeout, so one slow
   * free-tier response can outlast the agent's entire wall-clock budget - and
   * with retries the worst case is that multiplied by maxRetries. A bound the
   * caller can reason about has to live here, not in the loop above.
   */
  requestTimeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
  onEvent?: (kind: string, data: Record<string, unknown>) => void;
};

export class NimClient {
  private readonly limiter: RateLimiter;
  readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly opts: NimOptions) {
    this.model = opts.model;
    this.baseUrl = opts.baseUrl ?? "https://integrate.api.nvidia.com/v1";
    this.limiter = new RateLimiter(
      opts.perMinute ?? 49,
      opts.minSpacingMs ?? 1300,
    );
  }

  /**
   * One chat completion, bounded twice over.
   *
   * `deadline` is the caller's overall budget as an absolute timestamp. It is
   * honoured before each attempt and while backing off, so a run cannot spend
   * its remaining time asleep between retries. `requestTimeoutMs` bounds the
   * individual request. Both matter: the first stops the retry ladder running
   * past the budget, the second stops a single hung response doing the same.
   */
  async chat(args: {
    messages: ChatMessage[];
    tools?: ToolDef[];
    toolChoice?: "auto" | "required" | "none";
    deadline?: number;
    signal?: AbortSignal;
  }): Promise<ChatResult> {
    const maxRetries = this.opts.maxRetries ?? 4;
    const requestTimeoutMs = this.opts.requestTimeoutMs ?? 60_000;
    let lastErr: unknown;

    /** Time left in the caller's budget, or Infinity when it set none. */
    const remaining = () =>
      args.deadline === undefined ? Infinity : args.deadline - Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Below this there is no point asking: the request cannot come back in
      // time to be acted on, and starting it would only overrun the budget.
      if (remaining() < 1_000)
        throw new NonRetryable("model request abandoned: run budget exhausted");
      if (args.signal?.aborted)
        throw new NonRetryable("model request abandoned: cancelled");

      await this.limiter.acquire();
      const t0 = Date.now();

      // Never wait longer on one request than the whole run has left.
      const attemptMs = Math.min(requestTimeoutMs, remaining());
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), attemptMs);
      const relay = () => ctl.abort();
      args.signal?.addEventListener("abort", relay, { once: true });

      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          signal: ctl.signal,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.model,
            temperature: this.opts.temperature ?? 0,
            max_tokens: this.opts.maxTokens ?? 1200,
            messages: args.messages,
            ...(args.tools
              ? { tools: args.tools, tool_choice: args.toolChoice ?? "auto" }
              : {}),
          }),
        });

        if (res.status === 429 || res.status >= 500) {
          // Honour Retry-After when the provider sends one; otherwise back off
          // exponentially. Either way this is bounded.
          const retryAfter = Number(res.headers.get("retry-after"));
          const backoff =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(30_000, 2 ** attempt * 1000);
          this.opts.onEvent?.("model_retry", {
            status: res.status,
            attempt,
            backoffMs: backoff,
          });
          if (attempt === maxRetries)
            throw new Error(`${res.status} after ${maxRetries} retries`);
          if (backoff >= remaining())
            throw new NonRetryable(
              `${res.status}; no budget left to retry (${Math.max(0, Math.round(remaining() / 1000))}s remaining)`,
            );
          await sleep(backoff);
          continue;
        }

        if (!res.ok)
          throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);

        const json: any = await res.json();
        const msg = json.choices?.[0]?.message ?? {};
        return {
          content: msg.content ?? null,
          toolCalls: (msg.tool_calls ?? []) as ToolCall[],
          usage: json.usage,
          model: json.model ?? this.model,
          latencyMs: Date.now() - t0,
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof NonRetryable) throw e;
        // An abort is the budget or the operator talking. Retrying would
        // defeat the thing that aborted us, so it ends the call.
        if (ctl.signal.aborted) {
          const why = args.signal?.aborted
            ? "cancelled"
            : `no response within ${Math.round(attemptMs / 1000)}s`;
          this.opts.onEvent?.("model_timeout", { attempt, attemptMs, why });
          throw new NonRetryable(`model request abandoned: ${why}`);
        }
        if (attempt === maxRetries) break;
        const backoff = Math.min(30_000, 2 ** attempt * 1000);
        if (backoff >= remaining())
          throw new NonRetryable(
            `model request failed with no budget left to retry: ${String(lastErr)}`,
          );
        await sleep(backoff);
      } finally {
        clearTimeout(timer);
        args.signal?.removeEventListener("abort", relay);
      }
    }
    throw new Error(`model request failed: ${String(lastErr)}`);
  }
}
