import { describe, expect, it } from 'vitest';
import { referenceKindOf, valueNamesOf, valueReferences } from './value-references.js';

const id = (n: number) => `018f0000-0000-7000-8000-${String(n).padStart(12, '0')}`;
const field = (type: string, dataSource: unknown = null) => ({ type, dataSource });

describe('referenceKindOf', () => {
  it('USER and SITE fields point to people and sites', () => {
    expect(referenceKindOf(field('USER'))).toBe('users');
    expect(referenceKindOf(field('SITE'))).toBe('sites');
  });

  it('a select points to people or sites only through the USERS or SITES preset', () => {
    expect(referenceKindOf(field('SELECT', { kind: 'PRESET', preset: 'USERS' }))).toBe('users');
    expect(referenceKindOf(field('MULTI_SELECT', { kind: 'PRESET', preset: 'SITES' }))).toBe('sites');
    expect(referenceKindOf(field('SELECT', { kind: 'PRESET', preset: 'COMPANIES' }))).toBeUndefined();
    expect(referenceKindOf(field('SELECT', { kind: 'DATASET', datasetId: id(1), column: 'name' }))).toBeUndefined();
    expect(referenceKindOf(field('SELECT'))).toBeUndefined();
  });

  it('no other type points to anything, whatever its data source says', () => {
    expect(referenceKindOf(field('TEXT', { kind: 'PRESET', preset: 'USERS' }))).toBeUndefined();
    expect(referenceKindOf(field('FILE'))).toBeUndefined();
  });
});

describe('valueReferences', () => {
  it('collects the ids of every referencing value once, by kind', () => {
    const references = valueReferences([
      { value: id(1), field: field('USER') },
      { value: [id(2), id(1)], field: field('MULTI_SELECT', { kind: 'PRESET', preset: 'USERS' }) },
      { value: id(3), field: field('SITE') },
      { value: id(4), field: field('TEXT') },
    ]);
    expect(references).toEqual({ users: [id(1), id(2)], sites: [id(3)] });
  });

  it('ignores whatever is not a well-formed id, so it never reaches the database', () => {
    expect(valueReferences([{ value: 'not-an-id', field: field('USER') }, { value: [42, null, { id: id(1) }], field: field('MULTI_SELECT', { kind: 'PRESET', preset: 'SITES' }) }, { value: null, field: field('SITE') }])).toEqual({ users: [], sites: [] });
  });
});

describe('valueNamesOf', () => {
  it('names the ids found in the tenant, keyed as they appear in the values, and leaves the rest out', () => {
    const upper = id(5).toUpperCase();
    const names = valueNamesOf({ users: [id(1), upper, id(9)], sites: [id(3)] }, { users: new Map([[id(1), 'Ana Pérez'], [id(5), 'Luis Gómez']]), sites: new Map() });
    expect(names).toEqual({ users: { [id(1)]: 'Ana Pérez', [upper]: 'Luis Gómez' }, sites: {} });
  });
});
