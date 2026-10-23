import { useTranslation } from 'react-i18next';
import type { RouteObject } from 'react-router';
import { AcceptInvitationPage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/features/auth';
import { CatalogPage } from '@/features/catalog';
import { HomePage } from '@/features/home';
import { NotificationsPage } from '@/features/notifications';
import { OrganizationPage } from '@/features/organization';
import { PeoplePage } from '@/features/people';
import { ProfilePage } from '@/features/profile';
import { ReportsPage } from '@/features/reports';
import { SettingsPage } from '@/features/settings';
import { NewTicketPage, TicketBatchPage, TicketDetailPage, TicketInboxPage } from '@/features/tickets';
import { DatasetPage, DatasetsPage, ExportCatalogsPage, ExportPage, ExportsPage, MyExportsPage, PdfFormatPage, PdfTemplatePage, WorkflowBuilderPage, WorkflowPage, WorkflowsPage } from '@/features/workflows';
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

const builtSections: ReadonlySet<NavigationItemKey> = new Set(['home', 'tickets', 'workflows', 'reports', 'catalog', 'organization', 'people', 'settings']);

const ticketRoutes: RouteObject[] = [
  { path: paths.tickets, element: <TicketInboxPage /> },
  { path: paths.newTicket, element: <NewTicketPage /> },
  { path: paths.ticketBatches, element: <TicketBatchPage /> },
  { path: paths.ticket, element: <TicketDetailPage /> },
];

const workflowRoutes: RouteObject[] = [
  { path: paths.workflows, element: <WorkflowsPage /> },
  { path: paths.workflow, element: <WorkflowPage /> },
  { path: paths.workflowVersion, element: <WorkflowBuilderPage /> },
  { path: paths.pdfFormat, element: <PdfFormatPage /> },
  { path: paths.pdfTemplate, element: <PdfTemplatePage /> },
  { path: paths.datasets, element: <DatasetsPage /> },
  { path: paths.dataset, element: <DatasetPage /> },
  { path: paths.exports, element: <ExportsPage /> },
  { path: paths.newExport, element: <ExportPage /> },
  { path: paths.exportCatalogs, element: <ExportCatalogsPage /> },
  { path: paths.export, element: <ExportPage /> },
  { path: paths.myExports, element: <MyExportsPage /> },
];

const reportRoutes: RouteObject[] = [
  { path: paths.reports, element: <ReportsPage /> },
  { path: `${paths.reports}/:tab`, element: <ReportsPage /> },
];

const configurationRoutes: RouteObject[] = [
  { path: paths.catalog, element: <CatalogPage /> },
  { path: paths.organization, element: <OrganizationPage /> },
  { path: paths.people, element: <PeoplePage /> },
  { path: paths.profile, element: <ProfilePage /> },
  { path: paths.notifications, element: <NotificationsPage /> },
  { path: paths.settings, element: <SettingsPage /> },
  { path: `${paths.settings}/:tab`, element: <SettingsPage /> },
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
      { path: paths.resetPassword, element: <ResetPasswordPage /> },
      { path: paths.acceptInvitation, element: <AcceptInvitationPage /> },
    ],
  },
  {
    element: <RequireSession />,
    children: [
      {
        element: <AppLayout />,
        children: [{ index: true, element: <HomePage /> }, ...ticketRoutes, ...workflowRoutes, ...reportRoutes, ...configurationRoutes, ...sectionRoutes, { path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];
