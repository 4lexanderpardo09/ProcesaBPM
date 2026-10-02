import type { WorkflowValidation } from '../workflow/problems.js';
import type { ApproverNotFound } from '../contracts/approvals/types.js';

export const ERROR_CODES = {
  immutableData: 'IMMUTABLE_DATA',
  invalidState: 'INVALID_STATE',
  invalidReference: 'INVALID_REFERENCE',
  duplicate: 'DUPLICATE',
  overlap: 'OVERLAP',
  permissionDenied: 'PERMISSION_DENIED',
  invalidCalendar: 'INVALID_CALENDAR',
  invalidDuration: 'INVALID_DURATION',
  invalidCondition: 'INVALID_CONDITION',
  missingTenantContext: 'MISSING_TENANT_CONTEXT',
  tenantContextMismatch: 'TENANT_CONTEXT_MISMATCH',
  invalidTenantContext: 'INVALID_TENANT_CONTEXT',
  unauthenticated: 'UNAUTHENTICATED',
  invalidCredentials: 'INVALID_CREDENTIALS',
  invalidToken: 'INVALID_TOKEN',
  mfaNotImplemented: 'MFA_NOT_IMPLEMENTED',
  rateLimited: 'RATE_LIMITED',
  validationFailed: 'VALIDATION_FAILED',
  tenantSuspended: 'TENANT_SUSPENDED',
  missingCatalogPermission: 'MISSING_CATALOG_PERMISSION',
  platformAccessDenied: 'PLATFORM_ACCESS_DENIED',
  tenantSlugTaken: 'TENANT_SLUG_TAKEN',
  tenantNotFound: 'TENANT_NOT_FOUND',
  notFound: 'NOT_FOUND',
  approverNotFound: 'APPROVER_NOT_FOUND',
  workflowNotPublishable: 'WORKFLOW_NOT_PUBLISHABLE',
  staleRevision: 'STALE_REVISION',
  notImplemented: 'NOT_IMPLEMENTED',
  fieldValuesInvalid: 'FIELD_VALUES_INVALID',
  amountLimitExceeded: 'AMOUNT_LIMIT_EXCEEDED',
  workflowNotAvailable: 'WORKFLOW_NOT_AVAILABLE',
  companyRequired: 'COMPANY_REQUIRED',
  initiatorNotAllowed: 'INITIATOR_NOT_ALLOWED',
  noAssigneeCandidates: 'NO_ASSIGNEE_CANDIDATES',
  assigneeSelectionRequired: 'ASSIGNEE_SELECTION_REQUIRED',
  invalidAssignee: 'INVALID_ASSIGNEE',
  invalidTransition: 'INVALID_TRANSITION',
  noMatchingBranch: 'NO_MATCHING_BRANCH',
  maxLoopsReached: 'MAX_LOOPS_REACHED',
  ticketNotOpen: 'TICKET_NOT_OPEN',
  closeNotAllowed: 'CLOSE_NOT_ALLOWED',
  staleTicket: 'STALE_TICKET',
  closeRequired: 'CLOSE_REQUIRED',
  incidentNotOpen: 'INCIDENT_NOT_OPEN',
  parallelTaskNotPending: 'PARALLEL_TASK_NOT_PENDING',
  rejectionNotAllowed: 'REJECTION_NOT_ALLOWED',
  commentRequired: 'COMMENT_REQUIRED',
  ticketNotClosed: 'TICKET_NOT_CLOSED',
  invalidReopenStep: 'INVALID_REOPEN_STEP',
  invalidErrorType: 'INVALID_ERROR_TYPE',
  assigneeRequired: 'ASSIGNEE_REQUIRED',
  extraApprovalRequired: 'EXTRA_APPROVAL_REQUIRED',
  storageQuotaExceeded: 'STORAGE_QUOTA_EXCEEDED',
  fileNotUploaded: 'FILE_NOT_UPLOADED',
  fileRejected: 'FILE_REJECTED',
  attachmentsInvalid: 'ATTACHMENTS_INVALID',
  submissionFilesLimit: 'SUBMISSION_FILES_LIMIT',
  storageUnavailable: 'STORAGE_UNAVAILABLE',
  pdfDesignInvalid: 'PDF_DESIGN_INVALID',
  pdfMappingInvalid: 'PDF_MAPPING_INVALID',
  pdfTemplateInvalid: 'PDF_TEMPLATE_INVALID',
  pdfRenderFailed: 'PDF_RENDER_FAILED',
  documentSourceInUse: 'DOCUMENT_SOURCE_IN_USE',
  reportTooLarge: 'REPORT_TOO_LARGE',
  reportTimeout: 'REPORT_TIMEOUT',
  lastReopeningType: 'LAST_REOPENING_TYPE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface DomainErrorOptions {
  readonly cause?: unknown;
  /** Safe to show to the client (e.g. which fields failed validation); never put internals here. */
  readonly details?: unknown;
}

export class DomainError extends Error {
  readonly details: unknown;

  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: DomainErrorOptions,
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.details = options?.details;
    this.name = new.target.name;
  }
}

export class ImmutableDataError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.immutableData, message, options);
  }
}

export class InvalidStateError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidState, message, options);
  }
}

export class InvalidReferenceError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidReference, message, options);
  }
}

export class DuplicateError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.duplicate, message, options);
  }
}

export class OverlapError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.overlap, message, options);
  }
}

export class PermissionDeniedError extends DomainError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(ERROR_CODES.permissionDenied, message, options);
  }
}

export class InvalidCalendarError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.invalidCalendar, message);
  }
}

export class InvalidDurationError extends DomainError {
  constructor(message: string) {
    super(ERROR_CODES.invalidDuration, message);
  }
}

export class InvalidConditionError extends DomainError {
  constructor(message: string, options?: DomainErrorOptions) {
    super(ERROR_CODES.invalidCondition, message, options);
  }
}

export class MissingTenantContextError extends DomainError {
  constructor() {
    super(ERROR_CODES.missingTenantContext, 'A tenant context is required to query tenant data');
  }
}

export class TenantContextMismatchError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantContextMismatch, 'The database did not confirm the requested tenant context');
  }
}

export class InvalidTenantContextError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidTenantContext, 'The tenant context needs a tenantId and a userId that are UUIDs');
  }
}

/** Authentication failed or is missing: the reason is never disclosed (expired, revoked, malformed…). */
export class UnauthenticatedError extends DomainError {
  constructor() {
    super(ERROR_CODES.unauthenticated, 'Authentication is required');
  }
}

/** Wrong password, unknown e-mail, locked or disabled account: always the same error. */
export class InvalidCredentialsError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidCredentials, 'Invalid credentials');
  }
}

export class InvalidTokenError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super(ERROR_CODES.invalidToken, 'The token is invalid or has expired', options);
  }
}

export class MfaNotImplementedError extends DomainError {
  constructor() {
    super(ERROR_CODES.mfaNotImplemented, 'Multi-factor authentication is not available yet');
  }
}

export class RateLimitedError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super(ERROR_CODES.rateLimited, 'Too many requests');
  }
}

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationFailedError extends DomainError {
  constructor(issues: readonly ValidationIssue[]) {
    super(ERROR_CODES.validationFailed, 'The request is not valid', { details: { issues } });
  }
}

export class TenantSuspendedError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantSuspended, 'The organization is suspended');
  }
}

/** A role template names a permission that is not in the catalog: a deployment problem, not the caller's. */
export class MissingCatalogPermissionError extends DomainError {
  constructor(readonly missing: readonly string[]) {
    super(ERROR_CODES.missingCatalogPermission, `The permission catalog lacks: ${missing.join(', ')}`);
  }
}

/** The user is not (or is no longer) a platform administrator. */
export class PlatformAccessDeniedError extends DomainError {
  constructor() {
    super(ERROR_CODES.platformAccessDenied, 'Platform access is not allowed');
  }
}

export class TenantSlugTakenError extends DomainError {
  constructor(readonly slug: string) {
    super(ERROR_CODES.tenantSlugTaken, `The slug ${slug} is already taken`);
  }
}

export class TenantNotFoundError extends DomainError {
  constructor() {
    super(ERROR_CODES.tenantNotFound, 'The tenant does not exist');
  }
}

/** The record does not exist or belongs to another tenant: both answer the same, so existence is never confirmed. */
export class NotFoundError extends DomainError {
  constructor() {
    super(ERROR_CODES.notFound, 'The resource does not exist');
  }
}

/** No approver could be resolved; `reason` and the trace say where the search ended. */
export class ApproverNotFoundError extends DomainError {
  constructor(readonly outcome: ApproverNotFound) {
    super(ERROR_CODES.approverNotFound, `No approver found (${outcome.reason}) at level ${outcome.level}`, { details: outcome });
  }
}

/** The draft has validation errors; nothing was published. `details` carries the whole list. */
export class WorkflowNotPublishableError extends DomainError {
  constructor(readonly validation: WorkflowValidation) {
    super(ERROR_CODES.workflowNotPublishable, 'The workflow has errors and cannot be published', { details: validation });
  }
}

/** Someone saved the canvas after it was read: the client must reload before saving again. */
export class StaleRevisionError extends DomainError {
  constructor(readonly currentRevision: number) {
    super(ERROR_CODES.staleRevision, 'The workflow was changed by someone else', { details: { currentRevision } });
  }
}

/** A feature the model allows but the engine does not run yet (WAIT, PARALLEL, calculators…). */
export class NotImplementedError extends DomainError {
  constructor(readonly feature: string) {
    super(ERROR_CODES.notImplemented, `${feature} is not implemented yet`, { details: { feature } });
  }
}

export interface FieldValueIssue {
  readonly code: string;
  readonly fieldCode: string;
  readonly row?: number;
  readonly column?: string;
  /** Why a computed field failed (`FORMULA_ERROR`): `DIVISION_BY_ZERO`, `NUMBER_OVERFLOW`… */
  readonly reason?: string;
}

export class FieldValuesInvalidError extends DomainError {
  constructor(readonly issues: readonly FieldValueIssue[]) {
    super(ERROR_CODES.fieldValuesInvalid, 'Some field values are not valid', { details: { issues } });
  }
}

export class AmountLimitExceededError extends DomainError {
  constructor(readonly messages: readonly string[]) {
    super(ERROR_CODES.amountLimitExceeded, 'An amount exceeds its limit', { details: { messages } });
  }
}

export class WorkflowNotAvailableError extends DomainError {
  constructor() {
    super(ERROR_CODES.workflowNotAvailable, 'The category has no published workflow');
  }
}

export class CompanyRequiredError extends DomainError {
  constructor() {
    super(ERROR_CODES.companyRequired, 'Choose the company the ticket is created for');
  }
}

export class InitiatorNotAllowedError extends DomainError {
  constructor() {
    super(ERROR_CODES.initiatorNotAllowed, 'The requester cannot start this workflow');
  }
}

export class NoAssigneeCandidatesError extends DomainError {
  constructor(stepId: string, mode: string) {
    super(ERROR_CODES.noAssigneeCandidates, 'The step has nobody to assign', { details: { stepId, mode } });
  }
}

export interface AssigneeCandidate {
  readonly userId: string;
  readonly name: string;
}

export class AssigneeSelectionRequiredError extends DomainError {
  constructor(stepId: string, candidates: readonly AssigneeCandidate[]) {
    super(ERROR_CODES.assigneeSelectionRequired, 'Choose who the step is assigned to', { details: { stepId, candidates } });
  }
}

export class InvalidAssigneeError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidAssignee, 'The chosen user cannot be assigned to this step');
  }
}

export class InvalidTransitionError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidTransition, 'The transition does not leave the current step');
  }
}

export class NoMatchingBranchError extends DomainError {
  constructor(stepId: string) {
    super(ERROR_CODES.noMatchingBranch, 'No branch of the condition block matches', { details: { stepId } });
  }
}

export class MaxLoopsReachedError extends DomainError {
  constructor(stepId: string, maxLoops: number) {
    super(ERROR_CODES.maxLoopsReached, 'The step cannot be visited again', { details: { stepId, maxLoops } });
  }
}

export class TicketNotOpenError extends DomainError {
  constructor(readonly status: string) {
    super(ERROR_CODES.ticketNotOpen, 'The ticket is not open', { details: { status } });
  }
}

export class CloseNotAllowedError extends DomainError {
  constructor() {
    super(ERROR_CODES.closeNotAllowed, 'The current step does not allow closing the ticket');
  }
}

/** The caller acted on a step that is no longer the current one (someone else moved the ticket first). */
export class StaleTicketError extends DomainError {
  constructor() {
    super(ERROR_CODES.staleTicket, 'The ticket changed: reload it');
  }
}

/** The step can only be left by closing the ticket (`close_rule` REQUIRED). */
export class CloseRequiredError extends DomainError {
  constructor() {
    super(ERROR_CODES.closeRequired, 'This step can only be left by closing the ticket');
  }
}

/** Closing would skip the extra approval a cap on an amount demands. */
export class ExtraApprovalRequiredError extends DomainError {
  constructor() {
    super(ERROR_CODES.extraApprovalRequired, 'An amount exceeds its cap: the extra approval is required before the ticket can close');
  }
}

/** The incident was already resolved (or never was one of this ticket's open ones). */
export class IncidentNotOpenError extends DomainError {
  constructor() {
    super(ERROR_CODES.incidentNotOpen, 'The incident is not open');
  }
}

/** Nobody who held the step can take it back: the caller must name who gets it. */
export class AssigneeRequiredError extends DomainError {
  constructor(droppedAssigneeIds: readonly string[]) {
    super(ERROR_CODES.assigneeRequired, 'None of the previous assignees can take the ticket back: choose who gets it', { details: { droppedAssigneeIds } });
  }
}

export class TicketNotClosedError extends DomainError {
  constructor(readonly status: string) {
    super(ERROR_CODES.ticketNotClosed, 'Only a closed ticket can be reopened', { details: { status } });
  }
}

/** The step to reopen into is not one the ticket has been through. */
export class InvalidReopenStepError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidReopenStep, 'The ticket can only be reopened into a step it has been through');
  }
}

/** The error type is not an active reopening type (or the subtype does not belong to it). */
export class InvalidErrorTypeError extends DomainError {
  constructor() {
    super(ERROR_CODES.invalidErrorType, 'Choose an active error type meant for reopening');
  }
}

export class ParallelTaskNotPendingError extends DomainError {
  constructor() {
    super(ERROR_CODES.parallelTaskNotPending, 'The signature was already given, rejected or cancelled');
  }
}

/** The parallel step has no "rejected" way out, so nobody can reject it. */
export class RejectionNotAllowedError extends DomainError {
  constructor() {
    super(ERROR_CODES.rejectionNotAllowed, 'This step has no way out for a rejection');
  }
}

export class CommentRequiredError extends DomainError {
  constructor() {
    super(ERROR_CODES.commentRequired, 'A comment is required');
  }
}

export class StorageQuotaExceededError extends DomainError {
  constructor() {
    super(ERROR_CODES.storageQuotaExceeded, 'The storage quota of the plan is exhausted');
  }
}

/** Confirmation arrived before the browser finished uploading: the client can retry. */
export class FileNotUploadedError extends DomainError {
  constructor() {
    super(ERROR_CODES.fileNotUploaded, 'The file has not been uploaded yet');
  }
}

export type FileRejectionReason = 'SIZE_MISMATCH' | 'HASH_MISMATCH' | 'TYPE_NOT_ALLOWED' | 'TYPE_MISMATCH';

export class FileRejectedError extends DomainError {
  constructor(readonly reason: FileRejectionReason) {
    super(ERROR_CODES.fileRejected, 'The uploaded file was rejected', { details: { reason } });
  }
}

export interface AttachmentIssue {
  readonly fileId: string;
  readonly code: 'FILE_NOT_ATTACHABLE';
}

export class AttachmentsInvalidError extends DomainError {
  constructor(readonly issues: readonly AttachmentIssue[]) {
    super(ERROR_CODES.attachmentsInvalid, 'Some attachments cannot be attached', { details: { issues } });
  }
}

export class SubmissionFilesLimitError extends DomainError {
  constructor() {
    super(ERROR_CODES.submissionFilesLimit, 'Too many files or too many bytes in one submission');
  }
}

export class StorageUnavailableError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super(ERROR_CODES.storageUnavailable, 'The file storage is not available', options);
  }
}

export interface PdfProblemDetail {
  readonly code: string;
  readonly path: string;
  readonly detail?: string | undefined;
}

/** A designer format does not fit the workflow it belongs to (or is not a valid design at all). */
export class PdfDesignInvalidError extends DomainError {
  constructor(readonly problems: readonly PdfProblemDetail[]) {
    super(ERROR_CODES.pdfDesignInvalid, 'The PDF format is not valid', { details: { problems } });
  }
}

export class PdfMappingInvalidError extends DomainError {
  constructor(readonly problems: readonly PdfProblemDetail[]) {
    super(ERROR_CODES.pdfMappingInvalid, 'The PDF field mapping is not valid', { details: { problems } });
  }
}

export type PdfTemplateRejection = 'NOT_PDF' | 'ENCRYPTED' | 'TOO_MANY_PAGES' | 'TOO_COMPLEX' | 'MALFORMED' | 'PAGE_SIZE';

/** The uploaded PDF cannot be used as a template. */
export class PdfTemplateInvalidError extends DomainError {
  constructor(readonly reason: PdfTemplateRejection) {
    super(ERROR_CODES.pdfTemplateInvalid, 'The PDF cannot be used as a template', { details: { reason } });
  }
}

/** The preview could not be drawn (nothing is stored). */
export class PdfRenderFailedError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super(ERROR_CODES.pdfRenderFailed, 'The PDF could not be generated', options);
  }
}

/** A format or template that a workflow still uses: deactivate it instead of deleting it. */
export class DocumentSourceInUseError extends DomainError {
  constructor() {
    super(ERROR_CODES.documentSourceInUse, 'A workflow document still uses it: deactivate it instead');
  }
}

/** A report export that would not fit in a spreadsheet generated on the spot: narrow the filters. */
export class ReportTooLargeError extends DomainError {
  constructor(readonly maxRows: number) {
    super(ERROR_CODES.reportTooLarge, 'The report is too large to export: narrow the filters', { details: { maxRows } });
  }
}

/** The database gave up on a report after its time limit: the filters ask for too much at once. */
export class ReportTimeoutError extends DomainError {
  constructor(options?: { cause?: unknown }) {
    super(ERROR_CODES.reportTimeout, 'The report took too long: narrow the filters', options);
  }
}

/** Tickets can only be reopened under a reopening error type: the last active one cannot be switched off. */
export class LastReopeningTypeError extends DomainError {
  constructor() {
    super(ERROR_CODES.lastReopeningType, 'The last active reopening error type cannot be deactivated or changed');
  }
}
