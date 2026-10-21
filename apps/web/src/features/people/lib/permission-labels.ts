/**
 * The i18n keys of the permission catalog: the API describes it in English for developers, the role editor shows
 * it in Spanish. A subject or action the web does not know yet falls back to the API's own words.
 */
const SUBJECTS = {
  Ticket: 'permissions.subjects.Ticket',
  Workflow: 'permissions.subjects.Workflow',
  Category: 'permissions.subjects.Category',
  Subcategory: 'permissions.subjects.Subcategory',
  Priority: 'permissions.subjects.Priority',
  ErrorType: 'permissions.subjects.ErrorType',
  Company: 'permissions.subjects.Company',
  Site: 'permissions.subjects.Site',
  Department: 'permissions.subjects.Department',
  Position: 'permissions.subjects.Position',
  Calendar: 'permissions.subjects.Calendar',
  Membership: 'permissions.subjects.Membership',
  Role: 'permissions.subjects.Role',
  Group: 'permissions.subjects.Group',
  ApprovalGroup: 'permissions.subjects.ApprovalGroup',
  Delegation: 'permissions.subjects.Delegation',
  Dataset: 'permissions.subjects.Dataset',
  PdfDocument: 'permissions.subjects.PdfDocument',
  Report: 'permissions.subjects.Report',
  Export: 'permissions.subjects.Export',
  AuditLog: 'permissions.subjects.AuditLog',
  Storage: 'permissions.subjects.Storage',
  Setting: 'permissions.subjects.Setting',
  SupportAccess: 'permissions.subjects.SupportAccess',
  Webhook: 'permissions.subjects.Webhook',
} as const;

const ACTIONS = {
  create: 'permissions.actions.create',
  read: 'permissions.actions.read',
  update: 'permissions.actions.update',
  delete: 'permissions.actions.delete',
  manage: 'permissions.actions.manage',
  publish: 'permissions.actions.publish',
  generate: 'permissions.actions.generate',
  export: 'permissions.actions.export',
} as const;

/** Where the generic word would mislead: the actions on tickets, and a few others. */
const SPECIFIC = {
  'Ticket create': 'permissions.specific.ticketCreate',
  'Ticket create_for_others': 'permissions.specific.ticketCreateForOthers',
  'Ticket read_created': 'permissions.specific.ticketReadCreated',
  'Ticket read_assigned': 'permissions.specific.ticketReadAssigned',
  'Ticket read_observed': 'permissions.specific.ticketReadObserved',
  'Ticket read_all': 'permissions.specific.ticketReadAll',
  'Ticket comment': 'permissions.specific.ticketComment',
  'Ticket transition': 'permissions.specific.ticketTransition',
  'Ticket reassign': 'permissions.specific.ticketReassign',
  'Ticket open_incident': 'permissions.specific.ticketOpenIncident',
  'Ticket close': 'permissions.specific.ticketClose',
  'Ticket reopen': 'permissions.specific.ticketReopen',
  'Ticket report_error': 'permissions.specific.ticketReportError',
  'Ticket delete': 'permissions.specific.ticketDelete',
  'Workflow update': 'permissions.specific.workflowUpdate',
  'Export read': 'permissions.specific.exportRead',
  'Export update': 'permissions.specific.exportUpdate',
  'Export generate': 'permissions.specific.exportGenerate',
  'Delegation manage': 'permissions.specific.delegationManage',
  'SupportAccess manage': 'permissions.specific.supportAccessManage',
  'Setting update': 'permissions.specific.settingUpdate',
} as const;

export type SubjectLabelKey = (typeof SUBJECTS)[keyof typeof SUBJECTS];
export type ActionLabelKey = (typeof ACTIONS)[keyof typeof ACTIONS] | (typeof SPECIFIC)[keyof typeof SPECIFIC];

const lookup = <T extends Record<string, string>>(table: T, key: string): T[keyof T] | undefined => (Object.hasOwn(table, key) ? table[key as keyof T] : undefined);

export const subjectLabelKey = (subject: string): SubjectLabelKey | undefined => lookup(SUBJECTS, subject);

/** Delete on a configuration subject is "deactivate" in the API (configuration that is used is not erased). */
export const actionLabelKey = (subject: string, action: string): ActionLabelKey | undefined => lookup(SPECIFIC, `${subject} ${action}`) ?? lookup(ACTIONS, action);

/** The order of the editor: tickets and workflows first, then configuration, then the rest; unknown ones last. */
export function subjectOrder(subject: string): number {
  const index = Object.keys(SUBJECTS).indexOf(subject);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}
