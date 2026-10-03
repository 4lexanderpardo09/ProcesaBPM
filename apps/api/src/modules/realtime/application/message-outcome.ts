import type { SessionEndReason } from '@procesabpm/shared';

/** What a client message answers, and whether the socket must end once the answer is sent. */
export interface MessageOutcome<A> {
  readonly ack: A;
  readonly endWith: SessionEndReason | undefined;
}
