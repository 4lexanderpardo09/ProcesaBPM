import { ApiError, type GenericErrorMessage, genericErrorMessage } from '@/shared/api';

const FORBIDDEN = 403;
const NOT_FOUND = 404;

/** What was being done: the same API code means a different thing in each. */
export type WorkflowErrorContext = 'createWorkflow' | 'updateWorkflow' | 'createVersion' | 'deleteDraft' | 'observer' | 'field' | 'content';

export type WorkflowErrorMessage = { readonly namespace: 'workflows'; readonly key: string } | ({ readonly namespace: 'common' } & GenericErrorMessage);

const DUPLICATE_KEY: Readonly<Partial<Record<WorkflowErrorContext, string>>> = {
  createWorkflow: 'errors.subcategoryTaken',
  createVersion: 'errors.draftExists',
  observer: 'errors.observerExists',
  field: 'errors.fieldCodeTaken',
  content: 'errors.contentDuplicate',
};

/** Never the API's own text: a key of the `workflows` namespace, or the generic message (a key of `common`). */
export function workflowErrorMessage(error: unknown, context: WorkflowErrorContext): WorkflowErrorMessage {
  if (error instanceof ApiError) {
    const duplicate = DUPLICATE_KEY[context];
    if (error.code === 'DUPLICATE' && duplicate !== undefined) return { namespace: 'workflows', key: duplicate };
    if (error.status === FORBIDDEN) return { namespace: 'workflows', key: 'errors.forbidden' };
    if (error.status === NOT_FOUND) return { namespace: 'workflows', key: 'errors.notFound' };
    if (error.code === 'IMMUTABLE_DATA') return { namespace: 'workflows', key: 'errors.notDraft' };
    if (error.code === 'STALE_REVISION') return { namespace: 'workflows', key: 'builder.stale' };
    if (error.code === 'VALIDATION_FAILED' || error.code === 'INVALID_REFERENCE') return { namespace: 'workflows', key: 'errors.invalid' };
  }
  return { namespace: 'common', ...genericErrorMessage(error) };
}
