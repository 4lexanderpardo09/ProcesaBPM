import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AnthropicProvider } from './anthropic-provider.js';
import type { LlmCallError } from './llm-provider.js';

const KEY = 'sk-ant-test-0123456789abcdefghij';
const request = { system: 'system text', user: 'user text', tool: { name: 'submit_workflow_draft', description: 'Submit it', schema: { type: 'object' } } };

describe('AnthropicProvider (against a local fake Messages API)', () => {
  let server: Server;
  let baseUrl: string;
  let handler: (req: IncomingMessage, res: ServerResponse) => void;
  const seen: Array<{ url: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        seen.push({ url: req.url ?? '', headers: req.headers, body: JSON.parse(body) as Record<string, unknown> });
        handler(req, res);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => {
    seen.length = 0;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const provider = (timeoutMs = 5_000) => new AnthropicProvider({ apiKey: KEY, model: 'claude-haiku-5-5', effort: 'high', timeoutMs, baseUrl });

  /** Answers as the Messages API streams: named server-sent events, cut at arbitrary byte boundaries. */
  const stream = (events: ReadonlyArray<Record<string, unknown>>) => (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' });
    const bytes = Buffer.from(events.map((event) => `event: ${String(event['type'])}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    for (let at = 0; at < bytes.length; at += 7) res.write(bytes.subarray(at, at + 7));
    res.end();
  };
  const start = { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 300, cache_read_input_tokens: 3000, cache_creation_input_tokens: 200, output_tokens: 1 } } };
  const thinking = (index: number) => [
    { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: '' } },
    { type: 'content_block_stop', index },
  ];
  const tool = (index: number, name: string, pieces: readonly string[]) => [
    { type: 'content_block_start', index, content_block: { type: 'tool_use', id: `toolu_${index}`, name, input: {} } },
    ...pieces.map((partial_json) => ({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json } })),
    { type: 'content_block_stop', index },
  ];
  const end = (stop_reason: string, output_tokens = 9000) => [{ type: 'message_delta', delta: { stop_reason, stop_sequence: null }, usage: { output_tokens } }, { type: 'message_stop' }];
  const reply = (status: number, payload: unknown) => (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  it('streams one tool with tool_choice auto, adaptive thinking, the effort and a cached system prompt, the key only in its header', async () => {
    handler = stream([start, ...thinking(0), ...tool(1, 'submit_workflow_draft', ['{"steps": [{"ref": "ini', 'cio", "name": "Solicitud ñ"}', ']}']), ...end('tool_use')]);
    const heard: string[] = [];
    const result = await provider().complete(request, new AbortController().signal, (soFar) => heard.push(soFar));
    expect(result.answer).toEqual({ kind: 'tool_call', arguments: { steps: [{ ref: 'inicio', name: 'Solicitud ñ' }] } });
    expect(heard).toEqual(['{"steps": [{"ref": "ini', '{"steps": [{"ref": "inicio", "name": "Solicitud ñ"}', '{"steps": [{"ref": "inicio", "name": "Solicitud ñ"}]}']);
    expect(result.usage).toEqual({ promptTokens: 3500, cachedPromptTokens: 3000, completionTokens: 9000, reasoningTokens: 0 });
    expect(result.delivery).toEqual({ contentType: 'text/event-stream', streamed: true, reasoningChunks: 1, argumentChunks: 3, firstArgumentMs: expect.any(Number), lastArgumentMs: expect.any(Number) });
    const [call] = seen;
    expect(call!.url).toBe('/v1/messages');
    expect(call!.headers['x-api-key']).toBe(KEY);
    expect(call!.body).toMatchObject({
      model: 'claude-haiku-5-5',
      stream: true,
      system: [{ type: 'text', text: 'system text', cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: 'user text' }],
      tools: [{ name: 'submit_workflow_draft', description: 'Submit it', input_schema: { type: 'object' }, eager_input_streaming: true }],
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    });
    expect(call!.body).not.toHaveProperty('temperature');
    expect(JSON.stringify(call!.body)).not.toContain(KEY);
  });

  it('puts the pictures before the text of the user message', async () => {
    handler = stream([start, ...tool(0, 'submit_workflow_draft', ['{}']), ...end('tool_use')]);
    await provider().complete({ ...request, images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }, new AbortController().signal);
    expect(seen[0]!.body['messages']).toEqual([
      { role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } }, { type: 'text', text: 'user text' }] },
    ]);
  });

  it('follows only the asked tool, and takes plain text, a cut-short or declined answer or broken JSON as one without the tool', async () => {
    const heard: string[] = [];
    handler = stream([start, ...tool(0, 'other_tool', ['{"x": 1}']), ...end('tool_use', 5)]);
    const other = await provider().complete(request, new AbortController().signal, (soFar) => heard.push(soFar));
    expect(other.answer).toEqual({ kind: 'no_tool_call' });
    expect(other.usage.completionTokens).toBe(5);
    expect(heard).toEqual([]);
    handler = stream([start, { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Aquí está' } }, ...end('end_turn')]);
    expect((await provider().complete(request, new AbortController().signal)).answer).toEqual({ kind: 'no_tool_call' });
    handler = stream([start, ...tool(0, 'submit_workflow_draft', ['{"steps": []}']), ...end('max_tokens')]);
    expect((await provider().complete(request, new AbortController().signal)).answer).toEqual({ kind: 'no_tool_call' });
    handler = stream([start, ...tool(0, 'submit_workflow_draft', ['{"steps": []}']), ...end('refusal')]);
    expect((await provider().complete(request, new AbortController().signal)).answer).toEqual({ kind: 'no_tool_call' });
    handler = stream([start, ...tool(0, 'submit_workflow_draft', ['{"steps": [']), ...end('tool_use')]);
    expect((await provider().complete(request, new AbortController().signal)).answer).toEqual({ kind: 'no_tool_call' });
  });

  it('turns 429, other errors, an error mid-stream, a timeout and an abort into typed failures without the provider body', async () => {
    handler = reply(429, { type: 'error', error: { type: 'rate_limit_error', message: 'echo: user text' } });
    await expect(provider().complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'RATE_LIMITED', status: 429 });
    handler = reply(529, { type: 'error', error: { type: 'overloaded_error', message: 'user text' } });
    const failure = await provider().complete(request, new AbortController().signal).catch((error: unknown) => error as LlmCallError);
    expect(failure).toMatchObject({ kind: 'PROVIDER_ERROR', status: 529 });
    expect((failure as Error).message).not.toContain('user text');
    handler = stream([start, ...tool(0, 'submit_workflow_draft', ['{"steps": [']), { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]);
    await expect(provider().complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'PROVIDER_ERROR' });

    handler = () => undefined;
    await expect(provider(200).complete(request, new AbortController().signal)).rejects.toMatchObject({ kind: 'TIMEOUT' });
    const stop = new AbortController();
    const pending = provider().complete(request, stop.signal);
    stop.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'ABORTED' });
  });
});
