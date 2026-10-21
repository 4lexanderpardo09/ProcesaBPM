import type { ComponentType } from 'react';
import { BuildingIcon, ChartIcon, GridIcon, type IconProps, InboxIcon, UserIcon, WorkflowIcon } from '@/shared/ui';
import { paths } from '@/shared/lib/paths';
import type { PermissionCheck } from '@/shared/session';

export type NavigationItemKey = 'tickets' | 'workflows' | 'reports' | 'catalog' | 'organization' | 'people';

export interface NavigationItem {
  readonly key: NavigationItemKey;
  readonly path: string;
  readonly icon: ComponentType<IconProps>;
  /** Shown when the role grants any of these; without the list, to everyone. */
  readonly requires?: readonly PermissionCheck[];
}

export interface NavigationSection {
  readonly key: 'operation' | 'configuration';
  readonly items: readonly NavigationItem[];
}

/** The catalog screen manages these; an agent that only reads them to open tickets does not need it. */
const CATALOG_SCREENS: readonly PermissionCheck[] = [
  ['create', 'Category'],
  ['update', 'Category'],
  ['create', 'Subcategory'],
  ['update', 'Subcategory'],
  ['create', 'Priority'],
  ['update', 'Priority'],
  ['create', 'ErrorType'],
  ['update', 'ErrorType'],
];

/** The organization screen manages these. */
const ORGANIZATION_SCREENS: readonly PermissionCheck[] = ['Company', 'Site', 'Department', 'Position'].flatMap((subject) => [
  ['create', subject] as const,
  ['update', subject] as const,
]);

export const navigationSections: readonly NavigationSection[] = [
  {
    key: 'operation',
    items: [
      { key: 'tickets', path: paths.tickets, icon: InboxIcon },
      { key: 'workflows', path: paths.workflows, icon: WorkflowIcon, requires: [['read', 'Workflow']] },
      { key: 'reports', path: paths.reports, icon: ChartIcon, requires: [['read', 'Report']] },
    ],
  },
  {
    key: 'configuration',
    items: [
      { key: 'catalog', path: paths.catalog, icon: GridIcon, requires: CATALOG_SCREENS },
      { key: 'organization', path: paths.organization, icon: BuildingIcon, requires: ORGANIZATION_SCREENS },
      { key: 'people', path: paths.people, icon: UserIcon, requires: [['read', 'Membership'], ['read', 'Role'], ['read', 'Group']] },
    ],
  },
];
