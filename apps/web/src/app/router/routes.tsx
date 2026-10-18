import { useTranslation } from 'react-i18next';
import { Navigate, type RouteObject } from 'react-router';
import { ForgotPasswordPage, LoginPage } from '@/features/auth';
import { paths } from '@/shared/lib/paths';
import { AppLayout } from '../layouts/app-layout/AppLayout';
import { type NavigationItemKey, navigationSections } from '../layouts/app-layout/navigation';
import { AuthLayout } from '../layouts/auth-layout/AuthLayout';
import { NotFoundPage } from '../pages/NotFoundPage';
import { UnderConstructionPage } from '../pages/UnderConstructionPage';
import { RedirectIfSignedIn } from './guards/RedirectIfSignedIn';
import { RequireSession } from './guards/RequireSession';

function SectionPlaceholder({ itemKey }: { readonly itemKey: NavigationItemKey }) {
  const { t } = useTranslation('navigation');
  return <UnderConstructionPage title={t(`items.${itemKey}`)} />;
}

const sectionRoutes: RouteObject[] = navigationSections.flatMap((section) =>
  section.items.map((item) => ({ path: item.path, element: <SectionPlaceholder itemKey={item.key} /> })),
);

export const appRoutes: RouteObject[] = [
  {
    element: <AuthLayout />,
    children: [
      { element: <RedirectIfSignedIn />, children: [{ path: paths.login, element: <LoginPage /> }] },
      { path: paths.forgotPassword, element: <ForgotPasswordPage /> },
    ],
  },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppLayout />,
        children: [{ index: true, element: <Navigate to={paths.tickets} replace /> }, ...sectionRoutes, { path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];
