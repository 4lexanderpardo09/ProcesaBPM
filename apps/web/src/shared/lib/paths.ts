export const paths = {
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  acceptInvitation: '/accept-invitation',
  tickets: '/tickets',
  newTicket: '/tickets/new',
  ticketBatches: '/tickets/batch',
  ticket: '/tickets/:ticketId',
  workflows: '/workflows',
  workflow: '/workflows/:workflowId',
  workflowVersion: '/workflows/:workflowId/versions/:versionId',
  pdfFormat: '/workflows/:workflowId/formats/:formatId',
  pdfTemplate: '/workflows/:workflowId/templates/:templateId',
  datasets: '/workflows/datasets',
  exports: '/workflows/exports',
  newExport: '/workflows/exports/new',
  exportCatalogs: '/workflows/exports/catalogs',
  export: '/workflows/exports/:exportId',
  myExports: '/my-exports',
  dataset: '/workflows/datasets/:datasetId',
  reports: '/reports',
  catalog: '/catalog',
  organization: '/organization',
  people: '/people',
  profile: '/profile',
  notifications: '/notifications',
  settings: '/settings',
  platform: '/platform',
  platformTenant: '/platform/tenants/:tenantId',
  platformAnnouncements: '/platform/announcements',
  platformPlans: '/platform/plans',
  platformAdmins: '/platform/admins',
  platformAccounts: '/platform/accounts',
  platformCountries: '/platform/countries',
  platformOperations: '/platform/operations',
  platformAiUsage: '/platform/ai-usage',
  platformAudit: '/platform/audit',
  platformEmailSuppressions: '/platform/email-suppressions',
  platformDemoRequests: '/platform/demo-requests',
} as const;

export function ticketPath(ticketId: string): string {
  return `${paths.tickets}/${encodeURIComponent(ticketId)}`;
}

/** An organization in the platform console. */
export function platformTenantPath(tenantId: string): string {
  return `${paths.platform}/tenants/${encodeURIComponent(tenantId)}`;
}

/** "Procesar en lote" with only the tickets that went out in one export file. */
export function cutoffBatchPath(cutoffId: string): string {
  return `${paths.ticketBatches}?${new URLSearchParams({ cutoff: cutoffId }).toString()}`;
}

export function workflowPath(workflowId: string): string {
  return `${paths.workflows}/${encodeURIComponent(workflowId)}`;
}

export function workflowVersionPath(workflowId: string, versionId: string): string {
  return `${workflowPath(workflowId)}/versions/${encodeURIComponent(versionId)}`;
}

export function pdfFormatPath(workflowId: string, formatId: string): string {
  return `${workflowPath(workflowId)}/formats/${encodeURIComponent(formatId)}`;
}

export function pdfTemplatePath(workflowId: string, templateId: string): string {
  return `${workflowPath(workflowId)}/templates/${encodeURIComponent(templateId)}`;
}

export function exportPath(exportId: string): string {
  return `${paths.exports}/${encodeURIComponent(exportId)}`;
}

export function datasetPath(datasetId: string): string {
  return `${paths.datasets}/${encodeURIComponent(datasetId)}`;
}

/** Notices the login page accepts from its URL: a fixed list, never free text. */
export const loginNotices = ['expired', 'mfaRequired', 'signedOutElsewhere', 'passwordChanged', 'invitationAccepted'] as const;
export type UrlLoginNotice = (typeof loginNotices)[number];

export function isUrlLoginNotice(value: string | null): value is UrlLoginNotice {
  return loginNotices.some((notice) => notice === value);
}

/** The login page, remembering where to come back and why the person is there. */
export function loginPath(returnTo?: string, notice?: UrlLoginNotice): string {
  const query = new URLSearchParams();
  if (returnTo !== undefined && returnTo !== paths.home) query.set('returnTo', returnTo);
  if (notice !== undefined) query.set('notice', notice);
  const search = query.toString();
  return search === '' ? paths.login : `${paths.login}?${search}`;
}
