import { describe, expect, it, vi } from 'vitest';
import type { JsonLogger } from '../../../common/logging/json-logger.js';
import type { Clock } from '../../../infrastructure/clock.js';
import type { TenantTransaction } from '../../../infrastructure/database/tenant-transaction-runner.js';
import type { RenderFactsLoader } from './render-facts.loader.js';
import { TicketTextRenderer } from './ticket-text-renderer.js';

const TICKET = { number: '7', title: 'Sillas', status: 'OPEN', createdAt: new Date('2026-10-01T00:00:00Z'), closedAt: null, companyName: 'Acme', creatorId: 'u', creatorName: 'Ana', currentStepName: null } as const;
const facts = { ticket: TICKET, timeZone: 'America/Bogota', currencyCode: 'COP', fields: [], values: {}, names: { users: new Map(), sites: new Map(), files: new Map() }, signers: new Map(), now: new Date('2026-10-03T00:00:00Z') };

function setup(loaded: unknown) {
  const logger = { warn: vi.fn() };
  const renderer = new TicketTextRenderer({ load: vi.fn(async () => loaded) } as unknown as RenderFactsLoader, { now: () => new Date('2026-10-03T00:00:00Z') } as Clock, logger as unknown as JsonLogger);
  return { renderer, logger };
}
const tx = {} as TenantTransaction;

describe('TicketTextRenderer', () => {
  it('fills the placeholders with the ticket and keeps plain text', async () => {
    const { renderer, logger } = setup({ facts, workflowId: 'w', companyId: 'c', imageStorageKeys: new Map() });
    expect(await renderer.render(tx, 't', 'k', ['Ticket {{ticket.number}} de {{ticket.creatorName}}', 'sin variables'], { stepId: 's' })).toEqual(['Ticket 7 de Ana', 'sin variables']);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns null when the ticket no longer exists', async () => {
    const { renderer } = setup(null);
    expect(await renderer.render(tx, 't', 'k', ['x'], { stepId: 's' })).toBeNull();
  });

  it('returns a text that does not parse as written and logs the step, never the text', async () => {
    const { renderer, logger } = setup({ facts, workflowId: 'w', companyId: 'c', imageStorageKeys: new Map() });
    const secret = 'Hola {{ticket.nope}} clave-secreta';
    expect(await renderer.render(tx, 'tenant-1', 'k', ['ok {{ticket.number}}', secret], { stepId: 'step-9' })).toEqual(['ok 7', secret]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [payload] = logger.warn.mock.calls[0]!;
    expect(payload).toEqual({ event: 'notification.text_unparsed', tenantId: 'tenant-1', stepId: 'step-9', index: 1 });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('clave-secreta');
  });
});
