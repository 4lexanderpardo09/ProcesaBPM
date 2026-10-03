import { describe, expect, it } from 'vitest';
import { authRefreshSchema, RealtimeClientEvent, RealtimeServerEvent, ticketSubscribeSchema } from './events.js';

const id = '0199a000-0000-7000-8000-000000000001';

describe('realtime contracts', () => {
  it('ticket.subscribe takes exactly one ticket id', () => {
    expect(ticketSubscribeSchema.safeParse({ ticketId: id }).success).toBe(true);
    expect(ticketSubscribeSchema.safeParse({ ticketId: 'x' }).success).toBe(false);
    expect(ticketSubscribeSchema.safeParse({ ticketId: id, extra: 1 }).success).toBe(false);
    expect(ticketSubscribeSchema.safeParse({}).success).toBe(false);
  });

  it('auth.refresh takes a bounded token and nothing else', () => {
    expect(authRefreshSchema.safeParse({ token: 'a.b.c' }).success).toBe(true);
    expect(authRefreshSchema.safeParse({ token: '' }).success).toBe(false);
    expect(authRefreshSchema.safeParse({ token: 'x'.repeat(4097) }).success).toBe(false);
    expect(authRefreshSchema.safeParse({ token: 'a', other: true }).success).toBe(false);
  });

  it('keeps event names unique', () => {
    const names = [...Object.values(RealtimeServerEvent), ...Object.values(RealtimeClientEvent)];
    expect(new Set(names).size).toBe(names.length);
  });
});
