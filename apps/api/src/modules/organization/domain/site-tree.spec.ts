import { InvalidStateError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { assertMoveKeepsTreeAcyclic, buildTree, descendantIds, levelsAfterMove, type SiteNode } from './site-tree.js';

const sites: SiteNode[] = [
  { id: 'root', parentId: null, level: 1 },
  { id: 'a', parentId: 'root', level: 2 },
  { id: 'a1', parentId: 'a', level: 3 },
  { id: 'a2', parentId: 'a', level: 3 },
  { id: 'b', parentId: 'root', level: 2 },
];

describe('site tree', () => {
  it('finds every descendant', () => {
    expect([...descendantIds(sites, 'root')].sort()).toEqual(['a', 'a1', 'a2', 'b']);
    expect([...descendantIds(sites, 'a')].sort()).toEqual(['a1', 'a2']);
    expect(descendantIds(sites, 'b').size).toBe(0);
  });

  it.each([
    ['itself', 'a', 'a'],
    ['a child', 'a', 'a1'],
    ['a grandchild', 'root', 'a2'],
  ])('refuses to move a site below %s', (_label, siteId, parentId) => {
    expect(() => assertMoveKeepsTreeAcyclic(sites, siteId, parentId)).toThrow(InvalidStateError);
  });

  it('allows moving to a sibling branch or to the root', () => {
    expect(() => assertMoveKeepsTreeAcyclic(sites, 'a', 'b')).not.toThrow();
    expect(() => assertMoveKeepsTreeAcyclic(sites, 'a1', null)).not.toThrow();
  });

  it('recomputes the level of the moved site and its subtree', () => {
    expect(Object.fromEntries(levelsAfterMove(sites, 'a', 'b'))).toEqual({ a: 3, a1: 4, a2: 4 });
    expect(Object.fromEntries(levelsAfterMove(sites, 'a', null))).toEqual({ a: 1, a1: 2, a2: 2 });
  });

  it('builds the tree and keeps orphans at the root', () => {
    const tree = buildTree(sites);
    expect(tree.map((node) => node.id)).toEqual(['root']);
    expect(tree[0]!.children.map((node) => node.id)).toEqual(['a', 'b']);
    expect(tree[0]!.children[0]!.children.map((node) => node.id)).toEqual(['a1', 'a2']);
    expect(buildTree(sites.filter((site) => site.id !== 'a')).map((node) => node.id).sort()).toEqual(['a1', 'a2', 'root']);
  });
});
