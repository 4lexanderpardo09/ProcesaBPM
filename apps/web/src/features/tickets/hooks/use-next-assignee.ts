import { useState } from 'react';
import { type AssigneeChoice, assigneeChoicesOf } from '../lib/assignee-choices';

/** What to send as `assigneeId`: nothing yet, a chosen person, or "stop: someone has to be chosen first". */
export type NextAssigneeRequest = { readonly ok: true; readonly assigneeId?: string } | { readonly ok: false };

/**
 * The choice of who receives the next step: asked as soon as a preview says the step needs it (`offered`), or when the
 * answer is refused for it. The people the API refused with are kept in state (not read from the mutation's error), so
 * the field stays while the retry is in flight, and they win over the preview's: they are the latest word.
 */
export function useNextAssignee(offered?: readonly AssigneeChoice[]) {
  const [refusedWith, setChoices] = useState<readonly AssigneeChoice[]>();
  const [chosenId, setAssigneeId] = useState('');
  const [missing, setMissing] = useState(false);
  const choices = refusedWith ?? offered;
  // A pick that is no longer offered (the values typed sent the ticket elsewhere) is no pick.
  const assigneeId = choices?.some((choice) => choice.id === chosenId) === true ? chosenId : '';
  return {
    choices,
    assigneeId,
    missing,
    select(userId: string) {
      setAssigneeId(userId);
      setMissing(false);
    },
    request(): NextAssigneeRequest {
      if (choices === undefined) return { ok: true };
      if (assigneeId === '') {
        setMissing(true);
        return { ok: false };
      }
      return { ok: true, assigneeId };
    },
    /** Call with each failure: a request to choose shows the field, with the earlier pick kept if it is still offered. */
    onError(error: unknown) {
      const offered = assigneeChoicesOf(error);
      if (offered === undefined) return;
      setChoices(offered);
      setAssigneeId((current) => (offered.some((choice) => choice.id === current) ? current : ''));
    },
    /** The mutation's error, unless it is the request to choose (the field already says so). */
    shownError(error: unknown): unknown {
      return assigneeChoicesOf(error) === undefined ? error : null;
    },
  };
}

export type NextAssignee = ReturnType<typeof useNextAssignee>;
