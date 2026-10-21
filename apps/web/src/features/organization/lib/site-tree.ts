import type { SiteTreeNode } from '@procesabpm/shared';

export interface SiteRow {
  readonly site: SiteTreeNode;
  /** 0 for a root. */
  readonly depth: number;
}

/** The tree as rows, each parent before its children, siblings by name. */
export function flattenSites(roots: readonly SiteTreeNode[], depth = 0): SiteRow[] {
  return [...roots].sort((left, right) => left.name.localeCompare(right.name, 'es')).flatMap((site) => [{ site, depth }, ...flattenSites(site.children, depth + 1)]);
}

/** The site's own id and those of everything under it: none of them can become its parent. */
export function subtreeIds(site: SiteTreeNode): ReadonlySet<string> {
  return new Set([site.id, ...site.children.flatMap((child) => [...subtreeIds(child)])]);
}
