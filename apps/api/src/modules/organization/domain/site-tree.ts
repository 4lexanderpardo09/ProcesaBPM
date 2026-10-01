import { InvalidStateError } from '@procesabpm/shared';

export interface SiteNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly level: number;
}

export type TreeNode<T extends SiteNode> = T & { children: Array<TreeNode<T>> };

/** Ids of every site below `rootId` (not including it). */
export function descendantIds(sites: readonly SiteNode[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const site of sites) {
    if (site.parentId !== null) childrenOf.set(site.parentId, [...(childrenOf.get(site.parentId) ?? []), site.id]);
  }
  const found = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    for (const child of childrenOf.get(pending.pop()!) ?? []) {
      if (!found.has(child)) {
        found.add(child);
        pending.push(child);
      }
    }
  }
  return found;
}

/** A site cannot become its own parent nor a child of one of its descendants. */
export function assertMoveKeepsTreeAcyclic(sites: readonly SiteNode[], siteId: string, newParentId: string | null): void {
  if (newParentId === null) return;
  if (newParentId === siteId || descendantIds(sites, siteId).has(newParentId)) {
    throw new InvalidStateError('A site cannot be moved below itself or one of its descendants');
  }
}

/** The new level of the moved site and of each of its descendants: a site is one level below its parent. */
export function levelsAfterMove(sites: readonly SiteNode[], siteId: string, newParentId: string | null): Map<string, number> {
  const parent = newParentId === null ? undefined : sites.find((site) => site.id === newParentId);
  const levels = new Map<string, number>();
  const assign = (id: string, level: number): void => {
    if (levels.has(id)) return;
    levels.set(id, level);
    for (const child of sites.filter((site) => site.parentId === id)) assign(child.id, level + 1);
  };
  assign(siteId, (parent?.level ?? 0) + 1);
  return levels;
}

/** Roots first; the order of `sites` is kept among siblings. */
export function buildTree<T extends SiteNode>(sites: readonly T[]): Array<TreeNode<T>> {
  const nodes = new Map<string, TreeNode<T>>(sites.map((site) => [site.id, { ...site, children: [] }]));
  const roots: Array<TreeNode<T>> = [];
  for (const node of nodes.values()) {
    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    // A site whose parent was filtered out (e.g. inactive) is shown at the root rather than lost.
    (parent?.children ?? roots).push(node);
  }
  return roots;
}
