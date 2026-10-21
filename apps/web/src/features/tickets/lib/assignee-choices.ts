import { ApiError } from '@/shared/api';

export interface AssigneeChoice {
  readonly id: string;
  readonly name: string;
}

/**
 * The people the next step may go to when the API asks to choose one (`ASSIGNEE_SELECTION_REQUIRED`), or `undefined`
 * for any other error. The step is manual-selection only when it has several candidates, so the list is only known
 * after trying: the API answers with it instead of a separate endpoint.
 */
export function assigneeChoicesOf(error: unknown): readonly AssigneeChoice[] | undefined {
  if (!(error instanceof ApiError) || error.code !== 'ASSIGNEE_SELECTION_REQUIRED') return undefined;
  const candidates = (error.details as { candidates?: unknown } | undefined)?.candidates;
  if (!Array.isArray(candidates)) return [];
  return (candidates as readonly { userId?: unknown; name?: unknown }[]).flatMap((candidate) =>
    typeof candidate.userId === 'string' && typeof candidate.name === 'string' ? [{ id: candidate.userId, name: candidate.name }] : [],
  );
}
