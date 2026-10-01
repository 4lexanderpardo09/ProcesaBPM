import { describe, expect, it } from 'vitest';
import { filterBySiteScope } from './site-scope.js';

const people = [
  { userId: 'bogota', siteId: 'site-bogota' },
  { userId: 'colombia', siteId: 'site-colombia' },
  { userId: 'nowhere', siteId: null },
];
const ancestry = ['site-bogota', 'site-cundinamarca', 'site-colombia'];
const ids = (list: readonly { userId: string }[]) => list.map((item) => item.userId);

describe('filterBySiteScope', () => {
  it('SAME_SITE keeps only members of the ticket site', () => expect(ids(filterBySiteScope(people, 'SAME_SITE', 'site-bogota', ancestry))).toEqual(['bogota']));
  it('PARENT_SITE prefers the ticket site', () => expect(ids(filterBySiteScope(people, 'PARENT_SITE', 'site-bogota', ancestry))).toEqual(['bogota']));
  it('PARENT_SITE climbs to the nearest ancestor with candidates', () => expect(ids(filterBySiteScope(people.slice(1), 'PARENT_SITE', 'site-bogota', ancestry))).toEqual(['colombia']));
  it('PARENT_SITE finds nobody when no ancestor has candidates', () => expect(filterBySiteScope([people[2]!], 'PARENT_SITE', 'site-bogota', ancestry)).toEqual([]));
  it('ANY_SITE filters nothing', () => expect(filterBySiteScope(people, 'ANY_SITE', 'site-bogota', ancestry)).toHaveLength(3));
  it('a ticket without a site ignores the scope', () => expect(filterBySiteScope(people, 'SAME_SITE', null, [])).toHaveLength(3));
});
