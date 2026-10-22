export const paths = {
  home: '/',
  login: '/login',
  forgotPassword: '/forgot-password',
  tickets: '/tickets',
  newTicket: '/tickets/new',
  ticket: '/tickets/:ticketId',
  workflows: '/workflows',
  workflow: '/workflows/:workflowId',
  workflowVersion: '/workflows/:workflowId/versions/:versionId',
  pdfFormat: '/workflows/:workflowId/formats/:formatId',
  pdfTemplate: '/workflows/:workflowId/templates/:templateId',
  datasets: '/workflows/datasets',
  dataset: '/workflows/datasets/:datasetId',
  reports: '/reports',
  catalog: '/catalog',
  organization: '/organization',
  people: '/people',
  profile: '/profile',
  notifications: '/notifications',
} as const;

export function ticketPath(ticketId: string): string {
  return `${paths.tickets}/${encodeURIComponent(ticketId)}`;
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

export function datasetPath(datasetId: string): string {
  return `${paths.datasets}/${encodeURIComponent(datasetId)}`;
}

/** Notices the login page accepts from its URL: a fixed list, never free text. */
export const loginNotices = ['expired', 'mfaRequired', 'signedOutElsewhere'] as const;
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
