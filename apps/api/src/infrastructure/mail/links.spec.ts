import { describe, expect, it } from 'vitest';
import type { WorkerSettings } from '../../config/worker-settings.js';
import { WebLinks } from './links.js';

const links = (base: string) => new WebLinks({ WEB_BASE_URL: base } as WorkerSettings);

describe('WebLinks', () => {
  it('puts one-time tokens in the fragment, never in the query', () => {
    expect(links('https://app.test').resetPassword('abc_-')).toBe('https://app.test/reset-password#token=abc_-');
    expect(links('https://app.test').acceptInvitation('abc')).toBe('https://app.test/accept-invitation#token=abc');
  });
  it('links to the page that starts a reset without any token', () => {
    expect(links('https://host.test/app').forgotPassword()).toBe('https://host.test/app/forgot-password');
  });
  it('keeps the path of a web app served under one', () => {
    expect(links('https://host.test/app').resetPassword('t')).toBe('https://host.test/app/reset-password#token=t');
    expect(links('https://host.test/app/').ticket('tenant-1', 'ticket-1')).toBe('https://host.test/app/tickets/ticket-1?tenant=tenant-1');
  });
});
