import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LlmCallError } from './llm-provider.js';
import { OpenAiCompatibleProvider, UnconfiguredLlmProvider } from './openai-compatible-provider.js';

const KEY = 'sk-test-0123456789abcdefghij';
const request = { system: 'system text', user: 'user text', tool: { name: 'submit_workflow_draft', description: 'Submit it', schema: { type: 'object' } } };

describe('OpenAiCompatibleProvider (against a local fake server)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: (req: IncomingMessage, body: string, res: ServerResponse) => void;
  const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(body) as Record<string, unknown> });
        handler(req, body, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/beta/`;
  });
  afterEach(() => {
    seen.length = 0;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const provider = (timeoutMs = 5_000) => new OpenAiCompatibleProvider({ providerName: 'deepseek', baseUrl, apiKey: KEY, model: 'deepseek-v4-pro', strictTools: true, timeoutMs });
  const reply = (status: number, payload: unknown) => (_req: IncomingMessage, _body: string, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };
  const toolAnswer = (args: string) => ({
    choices: [{ message: { role: 'assistant', tool_calls: [{ type: 'function', function: { name: 'submit_workflow_draft', arguments: args } }] } }],
    usage: { prompt_tokens: 3500, completion_tokens: 9000, prompt_cache_hit_tokens: 1200, completion_tokens_details: { reasoning_tokens: 6400 } },
  });

  it('sends one strict tool with tool_choice auto, the key only in the header, and reads the arguments and the usage', async () => {
    handler = reply(200, toolAnswer('{"steps":[]}'));
    const result = await provider().complete(request, new AbortController().signal);
    expect(result.answer).toEqual({ kind: 'tool_call', arguments: { steps: [] } });
    expect(result.usage).toEqual({ promptTokens: 3500, cachedPromptTokens: 1200, completionTokens: 9000, reasoningTokens: 6400 });
    const [call] = seen;
    expect(call!.url).toBe('/beta/chat/completions');
    expect(call!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call!.body).toMatchObject({
      model: 'deepseek-v4-pro',
      tool_choice: 'auto',
      messages: [{ role: 'system', content: 'system text' }, { role: 'user', content: 'user text' }],
      tools: [{ type: 'function', function: { name: 'submit_workflow_draft', strict: true, parameters: { type: 'object' } } }],
    });
    expect(JSON.stringify(call!.body)).not.toContain(KEY);
  });

  it('reports plain text or broken JSON as an answer without the tool', async () => {
    handler = reply(200, { choices: [{ message: { content: 'Aquí está tu flujo' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    expect((await provider().complete(request, new AbortController().signal)).answer).toEqual({ kind: 'no_tool_call' });
    handler = reply(200, toolAnswer('{"steps": ['));
    const broken = await provider().complete(request, new AbortController().signal);
    expect(broken.answer).toEqual({ kind: 'no_tool_call' });
    expect(broken.usage.completionTokens).toBe(9000);
  });

  it('turns 429, other errors, a timeout and an abort into typed failures without the provider body', async () => {
    handler = reply(429, { error: { message: 'echo of the prompt: user text' } });
    await expect(provider().complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'RATE_LIMITED', status: 429 });
    handler = reply(500, { error: { message: 'user text' } });
    const failure = await provider().complete(request, new AbortController().signal).catch((error: unknown) => error as LlmCallError);
    expect(failure).toMatchObject({ kind: 'PROVIDER_ERROR', status: 500 });
    expect((failure as Error).message).not.toContain('user text');

    handler = () => undefined;
    await expect(provider(200).complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'TIMEOUT' });
    const stop = new AbortController();
    const pending = provider().complete(request, stop.signal);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'ABORTED' });
  });

  it('fails every call NOT_CONFIGURED when there is no key', async () => {
    await expect(new UnconfiguredLlmProvider('deepseek', 'deepseek-v4-pro').complete()).rejects.toMatchObject({ kind: 'NOT_CONFIGURED' });
  });
});
