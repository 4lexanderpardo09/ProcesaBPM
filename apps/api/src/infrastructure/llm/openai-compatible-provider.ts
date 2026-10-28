import { LlmCallError, type LlmAnswer, LlmProvider, type LlmRequest, type LlmResult, type LlmUsage } from './llm-provider.js';

export interface OpenAiCompatibleOptions {
  readonly providerName: string;
  /** Up to the version prefix, e.g. https://api.deepseek.com/beta (strict tools live there for DeepSeek). */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly strictTools: boolean;
  readonly timeoutMs: number;
}

interface ChatCompletion {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly tool_calls?: ReadonlyArray<{ readonly function?: { readonly name?: string; readonly arguments?: string } }> } }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_cache_hit_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number };
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
  };
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

/**
 * Chat completions with one tool, over the OpenAI-compatible API that DeepSeek (and others) expose. `tool_choice`
 * stays `auto`: reasoning models refuse a forced tool, so the prompt asks for it and the caller handles an answer
 * without it. The key travels only in the Authorization header; nothing of the request or the answer is logged here.
 */
export class OpenAiCompatibleProvider extends LlmProvider {
  readonly name: string;
  readonly model: string;

  constructor(
    private readonly options: OpenAiCompatibleOptions,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    super();
    this.name = options.providerName;
    this.model = options.model;
  }

  async complete(request: LlmRequest, signal: AbortSignal): Promise<LlmResult> {
    const started = this.now();
    const elapsed = () => this.now() - started;
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    let body: ChatCompletion;
    try {
      response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
          tools: [{ type: 'function', function: { name: request.tool.name, description: request.tool.description, strict: this.options.strictTools, parameters: request.tool.schema } }],
          tool_choice: 'auto',
        }),
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new LlmCallError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR', elapsed(), response.status);
      }
      body = (await response.json()) as ChatCompletion;
    } catch (error) {
      if (error instanceof LlmCallError) throw error;
      if (signal.aborted) throw new LlmCallError('ABORTED', elapsed());
      if (timeout.aborted) throw new LlmCallError('TIMEOUT', elapsed());
      throw new LlmCallError('PROVIDER_ERROR', elapsed());
    }
    return { answer: this.answerOf(body, request.tool.name), usage: usageOf(body), durationMs: elapsed() };
  }

  private answerOf(body: ChatCompletion, toolName: string): LlmAnswer {
    const call = body.choices?.[0]?.message?.tool_calls?.find((candidate) => candidate.function?.name === toolName);
    const raw = call?.function?.arguments;
    if (typeof raw !== 'string') return { kind: 'no_tool_call' };
    try {
      return { kind: 'tool_call', arguments: JSON.parse(raw) as unknown };
    } catch {
      return { kind: 'no_tool_call' };
    }
  }
}

function usageOf(body: ChatCompletion): LlmUsage {
  const usage = body.usage;
  return {
    promptTokens: count(usage?.prompt_tokens),
    cachedPromptTokens: count(usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens),
    completionTokens: count(usage?.completion_tokens),
    reasoningTokens: count(usage?.completion_tokens_details?.reasoning_tokens),
  };
}

/** Stands in when no key is configured: every call fails NOT_CONFIGURED, so requests end with that code. */
export class UnconfiguredLlmProvider extends LlmProvider {
  constructor(
    readonly name: string,
    readonly model: string,
  ) {
    super();
  }

  complete(): Promise<LlmResult> {
    return Promise.reject(new LlmCallError('NOT_CONFIGURED', 0));
  }
}
