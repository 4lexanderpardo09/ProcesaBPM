import { useTranslation } from 'react-i18next';
import { Navigate, type RouteObject } from 'react-router';
import { ForgotPasswordPage, LoginPage } from '@/features/auth';
import { TicketInboxPage } from '@/features/tickets';
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

function TicketPlaceholder({ page }: { readonly page: 'newTicket' | 'detail' }) {
  const { t } = useTranslation('tickets');
  return <UnderConstructionPage title={t(`placeholders.${page}`)} />;
}

const builtSections: ReadonlySet<NavigationItemKey> = new Set(['tickets']);

const ticketRoutes: RouteObject[] = [
  { path: paths.tickets, element: <TicketInboxPage /> },
  { path: paths.newTicket, element: <TicketPlaceholder page="newTicket" /> },
  { path: paths.ticket, element: <TicketPlaceholder page="detail" /> },
];

const sectionRoutes: RouteObject[] = navigationSections.flatMap((section) =>
  section.items.filter((item) => !builtSections.has(item.key)).map((item) => ({ path: item.path, element: <SectionPlaceholder itemKey={item.key} /> })),
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
        children: [{ index: true, element: <Navigate to={paths.tickets} replace /> }, ...ticketRoutes, ...sectionRoutes, { path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];
