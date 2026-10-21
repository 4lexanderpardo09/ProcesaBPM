import type { SiteTreeNode } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { flattenSites, subtreeIds } from './site-tree';

const site = (id: string, name: string, children: SiteTreeNode[] = [], level = 1): SiteTreeNode => ({ id, parentId: null, level, name, isCentral: false, isActive: true, createdAt: '', children });

describe('site tree', () => {
  const tree = [site('s', 'Sur', [site('s1', 'Bodega sur', [], 2)]), site('n', 'Norte', [site('n2', 'Zeta', [], 2), site('n1', 'Alfa', [], 2)])];

  it('lists each parent before its children, siblings by name', () => {
    expect(flattenSites(tree).map((row) => `${'-'.repeat(row.depth)}${row.site.name}`)).toEqual(['Norte', '-Alfa', '-Zeta', 'Sur', '-Bodega sur']);
  });

  it('collects a site and everything under it', () => {
    expect([...subtreeIds(tree[1]!)].sort()).toEqual(['n', 'n1', 'n2']);
  });
});
