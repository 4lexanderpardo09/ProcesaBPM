import { LlmCallError, type LlmAnswer, type LlmDelivery, LlmProvider, type LlmRequest, type LlmResult, type LlmUsage, type ToolArgumentsListener } from './llm-provider.js';

export interface OpenAiCompatibleOptions {
  readonly providerName: string;
  /** Up to the version prefix, e.g. https://api.deepseek.com/beta (strict tools live there for DeepSeek). */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly strictTools: boolean;
  readonly timeoutMs: number;
}

interface ToolCallPart {
  readonly index?: number;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface ChatCompletion {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly tool_calls?: ReadonlyArray<ToolCallPart> } }>;
  readonly usage?: ChatUsage;
}

/** One server-sent event of a streamed answer: pieces of the tool calls, and the usage in the last one. */
interface ChatChunk {
  readonly choices?: ReadonlyArray<{ readonly delta?: { readonly reasoning_content?: string | null; readonly tool_calls?: ReadonlyArray<ToolCallPart> } }>;
  readonly usage?: ChatUsage;
}

interface ChatUsage {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
    readonly prompt_cache_hit_tokens?: number;
    readonly prompt_tokens_details?: { readonly cached_tokens?: number };
    readonly completion_tokens_details?: { readonly reasoning_tokens?: number };
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

/**
 * Chat completions with one tool, over the OpenAI-compatible API that DeepSeek (and others) expose. `tool_choice`
 * stays `auto`: reasoning models refuse a forced tool, so the prompt asks for it and the caller handles an answer
 * without it. The answer streams (server-sent events), so the caller can follow the tool's arguments as they are
 * written; a server that answers in one piece is read too. The key travels only in the Authorization header; nothing
 * of the request or the answer is logged here.
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

  async complete(request: LlmRequest, signal: AbortSignal, onArguments?: ToolArgumentsListener): Promise<LlmResult> {
    const started = this.now();
    const elapsed = () => this.now() - started;
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    let response: Response;
    let body: ChatCompletion;
    let delivery: LlmDelivery;
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
          stream: true,
          stream_options: { include_usage: true },
        }),
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new LlmCallError(response.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_ERROR', elapsed(), response.status);
      }
      const contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (contentType === 'text/event-stream' && response.body !== null) {
        const read = await readStream(response.body, request.tool.name, elapsed, onArguments);
        body = read.body;
        delivery = { contentType, streamed: true, ...read.facts };
      } else {
        body = (await response.json()) as ChatCompletion;
        delivery = { contentType, streamed: false, reasoningChunks: 0, argumentChunks: 0, firstArgumentMs: null, lastArgumentMs: null };
      }
    } catch (error) {
      if (error instanceof LlmCallError) throw error;
      if (signal.aborted) throw new LlmCallError('ABORTED', elapsed());
      if (timeout.aborted) throw new LlmCallError('TIMEOUT', elapsed());
      throw new LlmCallError('PROVIDER_ERROR', elapsed());
    }
    return { answer: this.answerOf(body, request.tool.name), usage: usageOf(body), durationMs: elapsed(), delivery };
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

/**
 * Puts a streamed answer back together as the one-piece answer it stands for: each tool call's arguments are the
 * concatenation of their pieces (by index). `onArguments` hears the named tool's arguments after each piece.
 */
async function readStream(
  stream: ReadableStream<Uint8Array>,
  toolName: string,
  elapsed: () => number,
  onArguments?: ToolArgumentsListener,
): Promise<{ body: ChatCompletion; facts: Omit<LlmDelivery, 'contentType' | 'streamed'> }> {
  const calls: Array<{ name: string; arguments: string }> = [];
  const facts = { reasoningChunks: 0, argumentChunks: 0, firstArgumentMs: null as number | null, lastArgumentMs: null as number | null };
  let usage: ChatUsage | undefined;
  let pending = '';
  const decoder = new TextDecoder();
  const take = (data: string) => {
    if (data === '[DONE]') return;
    const chunk = JSON.parse(data) as ChatChunk;
    usage = chunk.usage ?? usage;
    if ((chunk.choices?.[0]?.delta?.reasoning_content ?? '') !== '') facts.reasoningChunks += 1;
    for (const part of chunk.choices?.[0]?.delta?.tool_calls ?? []) {
      const call = (calls[part.index ?? 0] ??= { name: '', arguments: '' });
      call.name += part.function?.name ?? '';
      call.arguments += part.function?.arguments ?? '';
      if (call.name !== toolName || (part.function?.arguments ?? '') === '') continue;
      facts.argumentChunks += 1;
      facts.firstArgumentMs ??= elapsed();
      facts.lastArgumentMs = elapsed();
      onArguments?.(call.arguments);
    }
  };
  const lines = (text: string) => {
    for (const line of text.split('\n')) if (line.startsWith('data:')) take(line.slice('data:'.length).trim());
  };
  for await (const bytes of stream) {
    pending += decoder.decode(bytes, { stream: true });
    const end = pending.lastIndexOf('\n');
    if (end < 0) continue;
    lines(pending.slice(0, end));
    pending = pending.slice(end + 1);
  }
  lines(pending + decoder.decode());
  return { body: { choices: [{ message: { tool_calls: calls.map((call) => ({ function: call })) } }], ...(usage === undefined ? {} : { usage }) }, facts };
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
