import type { ComponentType } from 'react';
import { ChartIcon, GridIcon, type IconProps, InboxIcon, UserIcon, WorkflowIcon } from '@/shared/ui';
import { paths } from '../../router/paths';

export type NavigationItemKey = 'tickets' | 'workflows' | 'reports' | 'catalog' | 'people';

export interface NavigationItem {
  readonly key: NavigationItemKey;
  readonly path: string;
  readonly icon: ComponentType<IconProps>;
}

export interface NavigationSection {
  readonly key: 'operation' | 'configuration';
  readonly items: readonly NavigationItem[];
}

export const navigationSections: readonly NavigationSection[] = [
  {
    key: 'operation',
    items: [
      { key: 'tickets', path: paths.tickets, icon: InboxIcon },
      { key: 'workflows', path: paths.workflows, icon: WorkflowIcon },
      { key: 'reports', path: paths.reports, icon: ChartIcon },
    ],
  },
  {
    key: 'configuration',
    items: [
      { key: 'catalog', path: paths.catalog, icon: GridIcon },
      { key: 'people', path: paths.people, icon: UserIcon },
    ],
  },
];
