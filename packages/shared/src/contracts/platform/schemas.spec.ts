import { describe, expect, it } from 'vitest';
import { createTenantRequestSchema, TENANT_SLUG_PATTERN } from './schemas.js';

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
