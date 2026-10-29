import { describe, expect, it } from 'vitest';
import { builtInEmailPolicy, channelsFor, defaultChannels, type EmailPolicies, emailLocked, NO_EMAIL_POLICIES } from './channels.js';

describe('channelsFor', () => {
  it('mails by default only an assignment (and a workflow notification block), as the help desk does; the rest stays in the app', () => {
    expect(channelsFor(new Map(), 'u1', 'TICKET_ASSIGNED', NO_EMAIL_POLICIES)).toEqual({ inApp: true, email: true });
    expect(channelsFor(new Map(), 'u1', 'SYSTEM', NO_EMAIL_POLICIES)).toEqual({ inApp: true, email: true });
    expect(channelsFor(new Map(), 'u1', 'STORAGE_QUOTA', NO_EMAIL_POLICIES)).toEqual({ inApp: true, email: true });
    for (const type of ['TICKET_CREATED', 'TICKET_CLOSED', 'TICKET_REOPENED', 'INCIDENT_OPENED', 'SLA_OVERDUE', 'OBSERVER_UPDATE'] as const) {
      expect(channelsFor(new Map(), 'u1', type, NO_EMAIL_POLICIES)).toEqual({ inApp: true, email: false });
    }
  });
  it('uses the stored preference of that person and that type only', () => {
    const stored = new Map([['u1:TICKET_CLOSED', { inApp: false, email: true }]]);
    expect(channelsFor(stored, 'u1', 'TICKET_CLOSED', NO_EMAIL_POLICIES)).toEqual({ inApp: false, email: true });
    expect(channelsFor(stored, 'u2', 'TICKET_CLOSED', NO_EMAIL_POLICIES)).toEqual(defaultChannels('TICKET_CLOSED'));
    expect(channelsFor(stored, 'u1', 'TICKET_CREATED', NO_EMAIL_POLICIES)).toEqual(defaultChannels('TICKET_CREATED'));
  });
});

describe('the organization’s e-mail policy', () => {
  const policies: EmailPolicies = new Map([
    ['TICKET_CREATED', 'DEFAULT_ON'],
    ['TICKET_ASSIGNED', 'DEFAULT_OFF'],
    ['TICKET_CLOSED', 'OFF'],
  ]);

  it('changes the default of whoever never chose', () => {
    expect(channelsFor(new Map(), 'u1', 'TICKET_CREATED', policies)).toEqual({ inApp: true, email: true });
    expect(channelsFor(new Map(), 'u1', 'TICKET_ASSIGNED', policies)).toEqual({ inApp: true, email: false });
    expect(channelsFor(new Map(), 'u1', 'SYSTEM', policies)).toEqual({ inApp: true, email: true });
  });

  it('respects what a person chose, unless the e-mail is off for everyone; the app channel is never touched', () => {
    const stored = new Map([
      ['u1:TICKET_CREATED', { inApp: true, email: false }],
      ['u1:TICKET_ASSIGNED', { inApp: true, email: true }],
      ['u1:TICKET_CLOSED', { inApp: false, email: true }],
    ]);
    expect(channelsFor(stored, 'u1', 'TICKET_CREATED', policies)).toEqual({ inApp: true, email: false });
    expect(channelsFor(stored, 'u1', 'TICKET_ASSIGNED', policies)).toEqual({ inApp: true, email: true });
    expect(channelsFor(stored, 'u1', 'TICKET_CLOSED', policies)).toEqual({ inApp: false, email: false });
    expect(channelsFor(new Map(), 'u2', 'TICKET_CLOSED', policies)).toEqual({ inApp: true, email: false });
  });

  it('says which types are locked, and what each type does with no policy', () => {
    expect(emailLocked('TICKET_CLOSED', policies)).toBe(true);
    expect(emailLocked('TICKET_CREATED', policies)).toBe(false);
    expect(builtInEmailPolicy('TICKET_ASSIGNED')).toBe('DEFAULT_ON');
    expect(builtInEmailPolicy('TICKET_COMMENTED')).toBe('DEFAULT_OFF');
  });
});
