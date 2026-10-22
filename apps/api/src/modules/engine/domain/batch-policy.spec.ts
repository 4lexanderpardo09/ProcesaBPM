import { InvalidStateError, MAX_BATCH_TICKETS, PermissionDeniedError, type StepDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { type BatchCandidate, batchLimitOf, batchRefusal } from './batch-policy.js';

const step = (overrides: Partial<StepDocument> = {}) => ({ id: 's1', allowsBatch: true, config: {}, ...overrides }) as StepDocument;
const candidate = (overrides: Partial<BatchCandidate> = {}): BatchCandidate => ({ status: 'OPEN', step: step(), ownType: 'PRIMARY', sameStepCount: 1, ...overrides });

describe('batchLimitOf', () => {
  it('is the step\'s own limit, never more than a request carries', () => {
    expect(batchLimitOf(step({ config: { batch: { maxTickets: 20 } } }))).toBe(20);
    expect(batchLimitOf(step({ config: { batch: { maxTickets: 500 } } }))).toBe(MAX_BATCH_TICKETS);
    expect(batchLimitOf(step())).toBe(MAX_BATCH_TICKETS);
  });
});

describe('batchRefusal', () => {
  it('lets an open ticket on a batch step, held alone or in a pool, go', () => {
    expect(batchRefusal(candidate())).toBeNull();
    expect(batchRefusal(candidate({ ownType: 'POOL' }))).toBeNull();
  });

  it('refuses a ticket that is not open on a batch step', () => {
    expect(batchRefusal(candidate({ status: 'PAUSED' }))).toBeInstanceOf(InvalidStateError);
    expect(batchRefusal(candidate({ step: undefined }))).toBeInstanceOf(InvalidStateError);
    expect(batchRefusal(candidate({ step: step({ allowsBatch: false }) }))).toBeInstanceOf(InvalidStateError);
  });

  it('is only for whoever holds the ticket', () => {
    expect(batchRefusal(candidate({ ownType: undefined }))).toBeInstanceOf(PermissionDeniedError);
    expect(batchRefusal(candidate({ ownType: 'INCIDENT' }))).toBeInstanceOf(PermissionDeniedError);
  });

  it('refuses more tickets of one step than it takes', () => {
    expect(batchRefusal(candidate({ step: step({ config: { batch: { maxTickets: 2 } } }), sameStepCount: 3 }))).toBeInstanceOf(InvalidStateError);
  });
});
