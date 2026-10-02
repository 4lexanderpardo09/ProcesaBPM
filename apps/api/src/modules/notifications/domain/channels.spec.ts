import { describe, expect, it } from 'vitest';
import { channelsFor, DEFAULT_CHANNELS } from './channels.js';

describe('channelsFor', () => {
  it('defaults to both channels on when nothing is stored', () => {
    expect(channelsFor(new Map(), 'u1', 'TICKET_CLOSED')).toEqual(DEFAULT_CHANNELS);
  });
  it('uses the stored preference of that person and that type only', () => {
    const stored = new Map([['u1:TICKET_CLOSED', { inApp: false, email: true }]]);
    expect(channelsFor(stored, 'u1', 'TICKET_CLOSED')).toEqual({ inApp: false, email: true });
    expect(channelsFor(stored, 'u2', 'TICKET_CLOSED')).toEqual(DEFAULT_CHANNELS);
    expect(channelsFor(stored, 'u1', 'TICKET_CREATED')).toEqual(DEFAULT_CHANNELS);
  });
});
