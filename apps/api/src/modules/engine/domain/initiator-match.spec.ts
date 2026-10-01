import type { InitiatorDocument } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { isAllowedInitiator, type Requester } from './initiator-match.js';

const requester: Requester = { userId: 'u', positionId: 'p', departmentId: 'd', siteId: 'bogota', companyId: 'c', groupIds: new Set(['g']), siteAncestry: new Set(['bogota', 'colombia']) };
const initiator = (participantType: InitiatorDocument['participantType'], overrides: Partial<InitiatorDocument> = {}): InitiatorDocument => ({
  id: 'i', participantType, userId: null, positionId: null, groupId: null, departmentId: null, companyId: null, siteId: null, ...overrides,
});

describe('isAllowedInitiator', () => {
  it('is open to everyone without initiators', () => expect(isAllowedInitiator([], requester)).toBe(true));

  it.each([
    ['USER', { userId: 'u' }],
    ['POSITION', { positionId: 'p' }],
    ['GROUP', { groupId: 'g' }],
    ['DEPARTMENT', { departmentId: 'd' }],
    ['COMPANY', { companyId: 'c' }],
    ['SITE', { siteId: 'colombia' }],
  ] as const)('accepts a %s match', (type, fields) => expect(isAllowedInitiator([initiator(type, fields)], requester)).toBe(true));

  it.each([
    ['USER', { userId: 'other' }],
    ['POSITION', { positionId: 'other' }],
    ['GROUP', { groupId: 'other' }],
    ['DEPARTMENT', { departmentId: 'other' }],
    ['COMPANY', { companyId: 'other' }],
    ['SITE', { siteId: 'medellin' }],
  ] as const)('rejects a %s that does not match', (type, fields) => expect(isAllowedInitiator([initiator(type, fields)], requester)).toBe(false));

  it('any one match is enough', () => expect(isAllowedInitiator([initiator('USER', { userId: 'x' }), initiator('GROUP', { groupId: 'g' })], requester)).toBe(true));

  it('a requester without position, department or site matches none of those rows', () => {
    const bare = { ...requester, positionId: null, departmentId: null, siteId: null, siteAncestry: new Set<string>() };
    expect(isAllowedInitiator([initiator('POSITION'), initiator('DEPARTMENT'), initiator('SITE')], bare)).toBe(false);
  });
});
