import { ERROR_CODES, type ErrorCode } from '@procesabpm/shared';

export interface ErrorResponse {
  readonly status: number;
  /** Fixed text that is safe to show: errors raised by the database carry internals in their message. */
  readonly message: string;
}

const INTERNAL: ErrorResponse = { status: 500, message: 'Internal server error' };

/** docs/base-de-datos.md §8.5 for the database rules; the rest are the API's own errors. */
export const ERROR_RESPONSES: Readonly<Record<ErrorCode, ErrorResponse>> = {
  [ERROR_CODES.immutableData]: { status: 409, message: 'The data can no longer be changed' },
  [ERROR_CODES.invalidState]: { status: 422, message: 'The request cannot be processed in the current state' },
  [ERROR_CODES.invalidReference]: { status: 422, message: 'The request refers to data that does not exist' },
  [ERROR_CODES.duplicate]: { status: 409, message: 'The data already exists' },
  [ERROR_CODES.overlap]: { status: 409, message: 'The period overlaps with existing data' },
  [ERROR_CODES.permissionDenied]: { status: 403, message: 'Not allowed' },
  [ERROR_CODES.invalidCalendar]: { status: 422, message: 'The calendar is not valid' },
  [ERROR_CODES.invalidDuration]: { status: 422, message: 'The duration is not valid' },
  [ERROR_CODES.invalidCondition]: { status: 422, message: 'The condition is not valid' },
  [ERROR_CODES.missingTenantContext]: INTERNAL,
  [ERROR_CODES.tenantContextMismatch]: INTERNAL,
  [ERROR_CODES.invalidTenantContext]: INTERNAL,
  [ERROR_CODES.unauthenticated]: { status: 401, message: 'Authentication is required' },
  [ERROR_CODES.invalidCredentials]: { status: 401, message: 'Invalid credentials' },
  [ERROR_CODES.invalidToken]: { status: 400, message: 'The token is invalid or has expired' },
  [ERROR_CODES.mfaNotImplemented]: { status: 501, message: 'Multi-factor authentication is not available yet' },
  [ERROR_CODES.rateLimited]: { status: 429, message: 'Too many requests' },
  [ERROR_CODES.validationFailed]: { status: 400, message: 'The request is not valid' },
  [ERROR_CODES.missingCatalogPermission]: INTERNAL,
  [ERROR_CODES.platformAccessDenied]: { status: 403, message: 'Platform access is not allowed' },
  [ERROR_CODES.tenantSlugTaken]: { status: 409, message: 'The slug is already taken' },
  [ERROR_CODES.tenantNotFound]: { status: 404, message: 'The tenant does not exist' },
  [ERROR_CODES.approverNotFound]: { status: 422, message: 'No approver could be resolved' },
  [ERROR_CODES.workflowNotPublishable]: { status: 422, message: 'The workflow has errors and cannot be published' },
  [ERROR_CODES.staleRevision]: { status: 409, message: 'The workflow was changed by someone else: reload it' },
  [ERROR_CODES.notImplemented]: { status: 501, message: 'This feature is not available yet' },
  [ERROR_CODES.fieldValuesInvalid]: { status: 422, message: 'Some field values are not valid' },
  [ERROR_CODES.amountLimitExceeded]: { status: 422, message: 'An amount exceeds its limit' },
  [ERROR_CODES.workflowNotAvailable]: { status: 422, message: 'The category has no published workflow' },
  [ERROR_CODES.companyRequired]: { status: 422, message: 'Choose the company the ticket is created for' },
  [ERROR_CODES.initiatorNotAllowed]: { status: 403, message: 'The requester cannot start this workflow' },
  [ERROR_CODES.noAssigneeCandidates]: { status: 422, message: 'The step has nobody to assign' },
  [ERROR_CODES.assigneeSelectionRequired]: { status: 422, message: 'Choose who the step is assigned to' },
  [ERROR_CODES.invalidAssignee]: { status: 422, message: 'The chosen user cannot be assigned to this step' },
  [ERROR_CODES.invalidTransition]: { status: 422, message: 'The transition does not leave the current step' },
  [ERROR_CODES.noMatchingBranch]: { status: 422, message: 'No branch of the condition block matches' },
  [ERROR_CODES.maxLoopsReached]: { status: 422, message: 'The step cannot be visited again' },
  [ERROR_CODES.ticketNotOpen]: { status: 422, message: 'The ticket is not open' },
  [ERROR_CODES.closeNotAllowed]: { status: 422, message: 'The current step does not allow closing the ticket' },
  [ERROR_CODES.closeRequired]: { status: 422, message: 'This step can only be left by closing the ticket' },
  [ERROR_CODES.extraApprovalRequired]: { status: 422, message: 'The extra approval is required before the ticket can close' },
  [ERROR_CODES.staleTicket]: { status: 409, message: 'The ticket changed: reload it' },
  [ERROR_CODES.notFound]: { status: 404, message: 'The resource does not exist' },
  [ERROR_CODES.tenantSuspended]: { status: 403, message: 'The organization is suspended' },
};
