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
 *   openai/gpt-oss-20b          775ms     <- workhorse
 *   z-ai/glm-5.3                14.0s     <- fallback for harder decisions
 *   z-ai/glm-5.3-flash          42.1s
 *   moonshotai/kimi-k3          120.4s
 *
 * All four emitted a correct tool call. At ~15-20 calls per discovery run the
 * spread is decisive, so speed picked the default rather than capability.
 */

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

export type NimOptions = {
  apiKey: string;
  baseUrl?: string;
  model: string;
  perMinute?: number;
  minSpacingMs?: number;
  maxRetries?: number;
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

  async chat(args: {
    messages: ChatMessage[];
    tools?: ToolDef[];
    toolChoice?: "auto" | "required" | "none";
  }): Promise<ChatResult> {
    const maxRetries = this.opts.maxRetries ?? 4;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      await this.limiter.acquire();
      const t0 = Date.now();

      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
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
        if (attempt === maxRetries) break;
        await sleep(Math.min(30_000, 2 ** attempt * 1000));
      }
    }
    throw new Error(`model request failed: ${String(lastErr)}`);
  }
}
