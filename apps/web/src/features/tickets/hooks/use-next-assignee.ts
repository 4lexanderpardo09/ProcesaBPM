import { useState } from 'react';
import { type AssigneeChoice, assigneeChoicesOf } from '../lib/assignee-choices';

/** What to send as `assigneeId`: nothing yet, a chosen person, or "stop: someone has to be chosen first". */
export type NextAssigneeRequest = { readonly ok: true; readonly assigneeId?: string } | { readonly ok: false };

/**
 * The choice of who receives the next step, asked only after the API says the step needs it. The offered people are
 * kept in state (not read from the mutation's error), so the field stays while the retry is in flight.
 */
export function useNextAssignee() {
  const [choices, setChoices] = useState<readonly AssigneeChoice[]>();
  const [assigneeId, setAssigneeId] = useState('');
  const [missing, setMissing] = useState(false);
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
