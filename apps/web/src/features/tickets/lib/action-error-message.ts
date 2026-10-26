import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';

const FORBIDDEN = 403;
const CONFLICT = 409;
const UNPROCESSABLE = 422;

/** Why a ticket action failed, as a key of the `tickets` namespace, or the generic message (a key of `common`). */
export type ActionErrorMessage =
  | { readonly namespace: 'tickets'; readonly key: 'actions.errors.forbidden' | 'actions.errors.changed' | 'actions.errors.rejected' | 'actions.errors.assigneeRequired' | 'actions.errors.noCandidates' | 'actions.errors.signersRequired' }
  | { readonly namespace: 'tickets'; readonly key: 'actions.errors.amountLimit'; readonly values: { readonly messages: string } }
  | ({ readonly namespace: 'common' } & GenericErrorMessage);

/** The messages the workflow's administrator wrote for the amount limits that blocked the request. */
function limitMessages(details: unknown): string {
  const messages = typeof details === 'object' && details !== null && 'messages' in details ? (details as { messages: unknown }).messages : undefined;
  return Array.isArray(messages) ? messages.filter((message): message is string => typeof message === 'string' && message.trim() !== '').join(' ') : '';
}

/**
 * Never the API's own message: a permission problem, a ticket that changed meanwhile, a request the step refuses, or the
 * generic one. An amount limit shows the words the workflow's administrator wrote for it, which are meant for the person.
 */
export function actionErrorMessage(error: unknown): ActionErrorMessage {
  if (error instanceof ApiError) {
    if (error.code === 'ASSIGNEE_SELECTION_REQUIRED') return { namespace: 'tickets', key: 'actions.errors.assigneeRequired' };
    if (error.code === 'SIGNER_SELECTION_REQUIRED') return { namespace: 'tickets', key: 'actions.errors.signersRequired' };
    if (error.code === 'AMOUNT_LIMIT_EXCEEDED') return { namespace: 'tickets', key: 'actions.errors.amountLimit', values: { messages: limitMessages(error.details) } };
    if (error.code === 'NO_ASSIGNEE_CANDIDATES') return { namespace: 'tickets', key: 'actions.errors.noCandidates' };
    if (error.status === FORBIDDEN) return { namespace: 'tickets', key: 'actions.errors.forbidden' };
    if (error.status === CONFLICT || error.code === 'INVALID_STATE') return { namespace: 'tickets', key: 'actions.errors.changed' };
    if (error.status === UNPROCESSABLE) return { namespace: 'tickets', key: 'actions.errors.rejected' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
