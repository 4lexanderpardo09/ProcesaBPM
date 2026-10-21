import { useTranslation } from 'react-i18next';
import { Navigate, type RouteObject } from 'react-router';
import { ForgotPasswordPage, LoginPage } from '@/features/auth';
import { CatalogPage } from '@/features/catalog';
import { NotificationsPage } from '@/features/notifications';
import { OrganizationPage } from '@/features/organization';
import { PeoplePage } from '@/features/people';
import { ProfilePage } from '@/features/profile';
import { NewTicketPage, TicketDetailPage, TicketInboxPage } from '@/features/tickets';
import { WorkflowBuilderPage, WorkflowPage, WorkflowsPage } from '@/features/workflows';
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

const builtSections: ReadonlySet<NavigationItemKey> = new Set(['tickets', 'workflows', 'catalog', 'organization', 'people']);

const ticketRoutes: RouteObject[] = [
  { path: paths.tickets, element: <TicketInboxPage /> },
  { path: paths.newTicket, element: <NewTicketPage /> },
  { path: paths.ticket, element: <TicketDetailPage /> },
];

const workflowRoutes: RouteObject[] = [
  { path: paths.workflows, element: <WorkflowsPage /> },
  { path: paths.workflow, element: <WorkflowPage /> },
  { path: paths.workflowVersion, element: <WorkflowBuilderPage /> },
];

const configurationRoutes: RouteObject[] = [
  { path: paths.catalog, element: <CatalogPage /> },
  { path: paths.organization, element: <OrganizationPage /> },
  { path: paths.people, element: <PeoplePage /> },
  { path: paths.profile, element: <ProfilePage /> },
  { path: paths.notifications, element: <NotificationsPage /> },
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
        children: [{ index: true, element: <Navigate to={paths.tickets} replace /> }, ...ticketRoutes, ...workflowRoutes, ...configurationRoutes, ...sectionRoutes, { path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];
