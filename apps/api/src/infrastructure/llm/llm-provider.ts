/** A tool the model must call to answer: its arguments are the structured answer. */
export interface LlmTool {
  readonly name: string;
  readonly description: string;
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface LlmRequest {
  readonly system: string;
  readonly user: string;
  readonly tool: LlmTool;
}

export interface LlmUsage {
  readonly promptTokens: number;
  readonly cachedPromptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens: number;
}

export const NO_USAGE: LlmUsage = { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0, reasoningTokens: 0 };

/** What came back: the tool's arguments (parsed JSON, not yet validated), or anything else (plain text, broken JSON). */
export type LlmAnswer = { readonly kind: 'tool_call'; readonly arguments: unknown } | { readonly kind: 'no_tool_call' };

export interface LlmResult {
  readonly answer: LlmAnswer;
  readonly usage: LlmUsage;
  readonly durationMs: number;
}

export type LlmFailureKind = 'TIMEOUT' | 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'ABORTED' | 'NOT_CONFIGURED';

/** A call that produced no answer. Carries an HTTP status at most: provider bodies can echo the prompt. */
export class LlmCallError extends Error {
  constructor(
    readonly kind: LlmFailureKind,
    readonly durationMs: number,
    readonly status?: number,
  ) {
    super(status === undefined ? `LLM call failed: ${kind}` : `LLM call failed: ${kind} (HTTP ${status})`);
    this.name = 'LlmCallError';
  }
}

/** Told the tool's arguments written so far (the whole text each time) while the answer streams. Must not throw. */
export type ToolArgumentsListener = (argumentsSoFar: string) => void;

/** A language model behind an API. `name` and `model` go to the usage ledger. */
export abstract class LlmProvider {
  abstract readonly name: string;
  abstract readonly model: string;
  abstract complete(request: LlmRequest, signal: AbortSignal, onArguments?: ToolArgumentsListener): Promise<LlmResult>;
}
