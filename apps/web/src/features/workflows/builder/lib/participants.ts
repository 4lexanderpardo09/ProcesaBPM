import type { CandidateDocument, InitiatorDocument, ReplaceCandidatesRequest, ReplaceInitiatorsRequest } from '@procesabpm/shared';
import type { RecordKind } from '../hooks/use-record-names';

export interface Participant {
  readonly kind: RecordKind;
  readonly id: string;
}

const idOf = (row: { userId: string | null; positionId: string | null; groupId: string | null; departmentId?: string | null; companyId?: string | null; siteId?: string | null }) =>
  row.userId ?? row.positionId ?? row.groupId ?? row.departmentId ?? row.companyId ?? row.siteId ?? '';

export const fromCandidates = (rows: readonly CandidateDocument[]): Participant[] => rows.map((row) => ({ kind: row.participantType, id: idOf(row) }));
export const fromInitiators = (rows: readonly InitiatorDocument[]): Participant[] => rows.map((row) => ({ kind: row.participantType, id: idOf(row) }));

const KEY: Readonly<Record<RecordKind, string>> = { USER: 'userId', POSITION: 'positionId', GROUP: 'groupId', DEPARTMENT: 'departmentId', COMPANY: 'companyId', SITE: 'siteId' };

/** The body of `PUT …/candidates`: only people, positions and groups can take a step. */
export function toCandidates(items: readonly Participant[]): ReplaceCandidatesRequest {
  return {
    candidates: items
      .filter((item) => item.kind === 'USER' || item.kind === 'POSITION' || item.kind === 'GROUP')
      .map((item) => ({ participantType: item.kind, [KEY[item.kind]]: item.id }) as ReplaceCandidatesRequest['candidates'][number]),
  };
}

export function toInitiators(items: readonly Participant[]): ReplaceInitiatorsRequest {
  return { initiators: items.map((item) => ({ participantType: item.kind, [KEY[item.kind]]: item.id }) as ReplaceInitiatorsRequest['initiators'][number]) };
}

/** A NOTIFICATION's own recipients (in its config): specific people, positions or groups. */
export function fromRecipients(recipients: ReadonlyArray<{ readonly kind: string; readonly id?: string }>): Participant[] {
  return recipients.filter((recipient): recipient is { kind: 'USER' | 'POSITION' | 'GROUP'; id: string } => recipient.id !== undefined && ['USER', 'POSITION', 'GROUP'].includes(recipient.kind)).map((recipient) => ({ kind: recipient.kind, id: recipient.id }));
}
