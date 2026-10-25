import { describe, expect, it } from 'vitest';
import { channelsFor, defaultChannels } from './channels.js';

describe('channelsFor', () => {
  it('mails by default only an assignment (and a workflow notification block), as the help desk does; the rest stays in the app', () => {
    expect(channelsFor(new Map(), 'u1', 'TICKET_ASSIGNED')).toEqual({ inApp: true, email: true });
    expect(channelsFor(new Map(), 'u1', 'SYSTEM')).toEqual({ inApp: true, email: true });
    expect(channelsFor(new Map(), 'u1', 'STORAGE_QUOTA')).toEqual({ inApp: true, email: true });
    for (const type of ['TICKET_CREATED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'INCIDENT_OPENED', 'SLA_OVERDUE', 'OBSERVER_UPDATE'] as const) {
      expect(channelsFor(new Map(), 'u1', type)).toEqual({ inApp: true, email: false });
    }
  });
  it('uses the stored preference of that person and that type only', () => {
    const stored = new Map([['u1:TICKET_CLOSED', { inApp: false, email: true }]]);
    expect(channelsFor(stored, 'u1', 'TICKET_CLOSED')).toEqual({ inApp: false, email: true });
    expect(channelsFor(stored, 'u2', 'TICKET_CLOSED')).toEqual(defaultChannels('TICKET_CLOSED'));
    expect(channelsFor(stored, 'u1', 'TICKET_CREATED')).toEqual(defaultChannels('TICKET_CREATED'));
  });
});
