import { createServer } from 'node:http';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

describe('failed status assertions show what the API answered', () => {
  const server = createServer((_req, res) => {
    res.statusCode = 422;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: { code: 'TICKET_NOT_OPEN', details: { status: 'CLOSED' } } }));
  });

  it('adds the request, the status and the body to the message', async () => {
    const failure = await request(server).get('/tickets/1').expect(200).then(() => undefined, (error: Error) => error);
    expect(failure?.message).toContain('expected 200 "OK", got 422');
    expect(failure?.message).toContain('GET /tickets/1 -> 422');
    expect(failure?.message).toContain('"code":"TICKET_NOT_OPEN"');
    expect(failure?.message).toContain('"status":"CLOSED"');
  });

  it('does the same for a list of accepted statuses', async () => {
    const failure = await request(server).get('/x').expect([200, 201]).then(() => undefined, (error: Error) => error);
    expect(failure?.message).toContain('"code":"TICKET_NOT_OPEN"');
  });

  it('leaves passing assertions alone', async () => {
    await request(server).get('/x').expect(422);
  });
});
