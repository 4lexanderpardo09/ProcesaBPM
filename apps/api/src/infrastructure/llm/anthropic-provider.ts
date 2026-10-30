import Anthropic from '@anthropic-ai/sdk';
import { LlmCallError, type LlmAnswer, LlmProvider, type LlmRequest, type LlmResult, type LlmUsage, type ToolArgumentsListener } from './llm-provider.js';

/** AI_PROVIDER_NAME of Claude; any other name is an OpenAI-compatible API. */
export const ANTHROPIC = 'anthropic';

/** How much the model thinks before it answers (`output_config.effort`); more is slower and costs more tokens. */
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffort = (typeof AI_EFFORTS)[number];

export interface AnthropicOptions {
  readonly apiKey: string;
  /** Any current Claude model, e.g. claude-haiku-5-5, claude-sonnet-5-5 or claude-opus-5-5. */
  readonly model: string;
  readonly effort: AiEffort;
  readonly timeoutMs: number;
  /** Only to point at a proxy or a test server; the SDK's own URL otherwise. */
  readonly baseUrl?: string;
}

/** Room for the thinking and the whole draft: thinking counts against it, and the answer streams, so a large cap costs nothing unused. */
const MAX_OUTPUT_TOKENS = 64_000;

const count = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : 0);

/**
 * The Messages API of Claude, with one tool. `tool_choice` stays `auto` (the newest models refuse a forced tool, and
 * forcing it would skip the thinking), so the prompt asks for the tool and the caller handles an answer without it.
 * Thinking is adaptive, its depth set by the effort. The answer streams with the tool's input sent as it is written
 * (`eager_input_streaming`), so the caller can follow it; the server does not validate that input, the caller does.
 * The system prompt is cached: it is the same on every round and every request. The SDK does not retry: a failed call
 * is a failed round, and the rounds must end inside the job's lease. Nothing of the request or the answer is logged.
 */
export class AnthropicProvider extends LlmProvider {
  readonly name = ANTHROPIC;
  readonly model: string;
  private readonly client: Anthropic;

  constructor(
    private readonly options: AnthropicOptions,
    private readonly now: () => number = Date.now,
    client?: Anthropic,
  ) {
    super();
    this.model = options.model;
    this.client = client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: 0, ...(options.baseUrl === undefined ? {} : { baseURL: options.baseUrl }) });
  }

  async complete(request: LlmRequest, signal: AbortSignal, onArguments?: ToolArgumentsListener): Promise<LlmResult> {
    const started = this.now();
    const elapsed = () => this.now() - started;
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const blocks = new Map<number, { readonly name: string; input: string }>();
    const facts = { reasoningChunks: 0, argumentChunks: 0, firstArgumentMs: null as number | null, lastArgumentMs: null as number | null };
    let usage: LlmUsage = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 };
    let stopReason: string | null = null;
    try {
      const stream = await this.client.messages.create(
        {
          model: this.options.model,
          max_tokens: MAX_OUTPUT_TOKENS,
          system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: request.user }],
          tools: [{ name: request.tool.name, description: request.tool.description, input_schema: request.tool.schema as Anthropic.Tool.InputSchema, eager_input_streaming: true }],
          tool_choice: { type: 'auto' },
          thinking: { type: 'adaptive' },
          output_config: { effort: this.options.effort },
          stream: true,
        },
        { signal: AbortSignal.any([signal, timeout]), timeout: this.options.timeoutMs },
      );
      for await (const event of stream) {
        switch (event.type) {
          case 'message_start':
            usage = usageOf(event.message.usage, usage.completionTokens);
            break;
          case 'content_block_start':
            if (event.content_block.type === 'tool_use') blocks.set(event.index, { name: event.content_block.name, input: '' });
            break;
          case 'content_block_delta':
            if (event.delta.type === 'thinking_delta') facts.reasoningChunks += 1;
            if (event.delta.type === 'input_json_delta') {
              const block = blocks.get(event.index);
              if (block === undefined || event.delta.partial_json === '') break;
              block.input += event.delta.partial_json;
              if (block.name !== request.tool.name) break;
              facts.argumentChunks += 1;
              facts.firstArgumentMs ??= elapsed();
              facts.lastArgumentMs = elapsed();
              onArguments?.(block.input);
            }
            break;
          case 'message_delta':
            stopReason = event.delta.stop_reason ?? stopReason;
            usage = { ...usage, completionTokens: count(event.usage.output_tokens) };
            break;
          default:
            break;
        }
      }
    } catch (error) {
      if (signal.aborted) throw new LlmCallError('ABORTED', elapsed());
      if (timeout.aborted || error instanceof Anthropic.APIConnectionTimeoutError) throw new LlmCallError('TIMEOUT', elapsed());
      if (error instanceof Anthropic.RateLimitError) throw new LlmCallError('RATE_LIMITED', elapsed(), 429);
      if (error instanceof Anthropic.APIError) throw new LlmCallError('PROVIDER_ERROR', elapsed(), error.status);
      throw new LlmCallError('PROVIDER_ERROR', elapsed());
    }
    const call = [...blocks.values()].find((block) => block.name === request.tool.name);
    return { answer: answerOf(call?.input, stopReason), usage, durationMs: elapsed(), delivery: { contentType: 'text/event-stream', streamed: true, ...facts } };
  }
}

/** The tool's input, unless the answer was cut short (out of tokens, or declined): a partial draft is no draft. */
function answerOf(input: string | undefined, stopReason: string | null): LlmAnswer {
  if (input === undefined || stopReason === 'max_tokens' || stopReason === 'refusal') return { kind: 'no_tool_call' };
  try {
    // A tool called without arguments streams no input at all.
    return { kind: 'tool_call', arguments: JSON.parse(input === '' ? '{}' : input) as unknown };
  } catch {
    return { kind: 'no_tool_call' };
  }
}

/** Claude counts the cached and the freshly cached prompt apart from the rest; the ledger's prompt is all of it. */
function usageOf(usage: Anthropic.Usage, completionTokens: number): LlmUsage {
  const cached = count(usage.cache_read_input_tokens);
  return {
    promptTokens: count(usage.input_tokens) + cached + count(usage.cache_creation_input_tokens),
    cachedPromptTokens: cached,
    completionTokens: Math.max(completionTokens, count(usage.output_tokens)),
    // Thinking is part of the output tokens; Claude does not count it apart.
    reasoningTokens: 0,
  };
}
