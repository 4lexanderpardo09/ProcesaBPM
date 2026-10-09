import { useTranslation } from 'react-i18next';
import { Navigate, type RouteObject } from 'react-router';
import { AppLayout } from '../layouts/app-layout/AppLayout';
import { type NavigationItemKey, navigationSections } from '../layouts/app-layout/navigation';
import { NotFoundPage } from '../pages/NotFoundPage';
import { UnderConstructionPage } from '../pages/UnderConstructionPage';
import { paths } from './paths';

function SectionPlaceholder({ itemKey }: { readonly itemKey: NavigationItemKey }) {
  const { t } = useTranslation('navigation');
  return <UnderConstructionPage title={t(`items.${itemKey}`)} />;
}

const sectionRoutes: RouteObject[] = navigationSections.flatMap((section) =>
  section.items.map((item) => ({ path: item.path, element: <SectionPlaceholder itemKey={item.key} /> })),
);

export const appRoutes: RouteObject[] = [
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to={paths.tickets} replace /> },
      ...sectionRoutes,
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
