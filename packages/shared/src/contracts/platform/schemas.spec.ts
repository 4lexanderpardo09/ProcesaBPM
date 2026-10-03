import { describe, expect, it } from 'vitest';
import { createTenantRequestSchema, mfaResetRequestSchema, platformUserLookupQuerySchema, TENANT_SLUG_PATTERN } from './schemas.js';

const valid = {
  slug: 'acme-co',
  name: 'Acme Co',
  planCode: 'professional',
  countryCode: 'CO',
  owner: { email: 'Owner@Acme.com ', firstName: 'Ana', lastName: 'Ruiz' },
};

describe('createTenantRequestSchema', () => {
  it('accepts a valid request and normalizes the owner e-mail and names', () => {
    const parsed = createTenantRequestSchema.parse({ ...valid, owner: { ...valid.owner, firstName: '  Ana ' } });
    expect(parsed.owner).toEqual({ email: 'owner@acme.com', firstName: 'Ana', lastName: 'Ruiz' });
  });

  it.each([
    ['a', true],
    ['acme', true],
    ['acme-co-2', true],
    ['a'.repeat(63), true],
    ['a'.repeat(64), false],
    ['', false],
    ['-acme', false],
    ['acme-', false],
    ['Acme', false],
    ['acme_co', false],
    ['acme co', false],
    ['acme.co', false],
    ['ácme', false],
    ['acme\n', false],
  ])('slug %j → %s (the same pattern as the database CHECK)', (slug, valid) => {
    expect(TENANT_SLUG_PATTERN.test(slug)).toBe(valid);
  });

  it.each([
    ['an invalid slug', { slug: 'Bad Slug' }],
    ['an empty name', { name: '  ' }],
    ['a name that is too long', { name: 'x'.repeat(201) }],
    ['a country code in lowercase', { countryCode: 'co' }],
    ['a country code with three letters', { countryCode: 'COL' }],
    ['no plan', { planCode: '' }],
    ['an owner without a valid e-mail', { owner: { ...valid.owner, email: 'not-an-email' } }],
    ['an owner without a first name', { owner: { ...valid.owner, firstName: ' ' } }],
    ['an owner with a very long last name', { owner: { ...valid.owner, lastName: 'x'.repeat(101) } }],
  ])('rejects %s', (_label, override) => {
    expect(createTenantRequestSchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });

  it('rejects a missing owner', () => {
    const { owner: _owner, ...withoutOwner } = valid;
    expect(createTenantRequestSchema.safeParse(withoutOwner).success).toBe(false);
  });
});

describe('mfaResetRequestSchema', () => {
  const ADMIN_ID = '018f3c1e-7b2a-7c3d-9e4f-0123456789ab';
  const valid = { reason: '  Lost the phone and the backup codes ', verification: { method: 'VIDEO_CALL', reference: ' CASE-1234 ' } };

  it('accepts a valid request and trims the reason and the reference', () => {
    expect(mfaResetRequestSchema.parse(valid)).toEqual({ reason: 'Lost the phone and the backup codes', verification: { method: 'VIDEO_CALL', reference: 'CASE-1234' } });
  });

  it('accepts a tenant administrator request with the requester', () => {
    const request = { ...valid, verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-1', tenantAdminUserId: ADMIN_ID } };
    expect(mfaResetRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each([
    ['an unknown method', { verification: { method: 'EMAIL', reference: 'CASE-1' } }],
    ['a reason under 10 characters', { reason: '  too short ' }],
    ['a reason over 500 characters', { reason: 'x'.repeat(501) }],
    ['a reference under 3 characters', { verification: { method: 'IN_PERSON', reference: ' ab ' } }],
    ['a reference over 200 characters', { verification: { method: 'IN_PERSON', reference: 'x'.repeat(201) } }],
    ['a tenant administrator request without the requester', { verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-1' } }],
    ['a requester with another method', { verification: { method: 'CALLBACK_KNOWN_NUMBER', reference: 'CASE-1', tenantAdminUserId: ADMIN_ID } }],
    ['a requester that is not a uuid', { verification: { method: 'TENANT_ADMIN_REQUEST', reference: 'CASE-1', tenantAdminUserId: 'admin' } }],
    ['an unknown field', { userId: ADMIN_ID }],
    ['an unknown verification field', { verification: { method: 'IN_PERSON', reference: 'CASE-1', documentNumber: '123' } }],
  ])('refuses %s', (_label, change) => {
    expect(mfaResetRequestSchema.safeParse({ ...valid, ...change }).success).toBe(false);
  });
});

describe('platformUserLookupQuerySchema', () => {
  it('takes one exact e-mail, normalized, and nothing else', () => {
    expect(platformUserLookupQuerySchema.parse({ email: ' Ana@Example.com ' })).toEqual({ email: 'ana@example.com' });
    expect(platformUserLookupQuerySchema.safeParse({ email: 'ana@' }).success).toBe(false);
    expect(platformUserLookupQuerySchema.safeParse({}).success).toBe(false);
    expect(platformUserLookupQuerySchema.safeParse({ email: 'ana@example.com', prefix: 'an' }).success).toBe(false);
  });
});
