import { MEMBER_DIRECTORY_LIMIT } from '@procesabpm/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { companiesQueryOptions, departmentsQueryOptions, groupsQueryOptions, positionsQueryOptions, sitesQueryOptions } from '@/features/people';
import { directoryNamesQueryOptions } from '@/features/profile';
import { useApiClient } from '@/shared/session';

export type RecordKind = 'USER' | 'POSITION' | 'GROUP' | 'DEPARTMENT' | 'COMPANY' | 'SITE';

export interface NamedRecord {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

/**
 * The records a participant can point at, by kind, and the name behind any id. Only the kinds asked for are read;
 * people come from the directory (names only), the rest from their lists.
 */
export function useRecordNames(kinds: ReadonlySet<RecordKind>, userIds: readonly string[]) {
  const client = useApiClient();
  const positions = useQuery({ ...positionsQueryOptions(client), enabled: kinds.has('POSITION') });
  const groups = useQuery({ ...groupsQueryOptions(client), enabled: kinds.has('GROUP') });
  const departments = useQuery({ ...departmentsQueryOptions(client), enabled: kinds.has('DEPARTMENT') });
  const companies = useQuery({ ...companiesQueryOptions(client), enabled: kinds.has('COMPANY') });
  const sites = useQuery({ ...sitesQueryOptions(client), enabled: kinds.has('SITE') });
  // The directory names a limited number of people per request: more are asked in batches.
  const unique = [...new Set(userIds)].sort();
  const batches = Array.from({ length: Math.ceil(unique.length / MEMBER_DIRECTORY_LIMIT) }, (_unused, index) => unique.slice(index * MEMBER_DIRECTORY_LIMIT, (index + 1) * MEMBER_DIRECTORY_LIMIT));
  const people = useQueries({ queries: batches.map((batch) => directoryNamesQueryOptions(client, batch)) });

  const records: Readonly<Record<Exclude<RecordKind, 'USER'>, readonly NamedRecord[]>> = {
    POSITION: positions.data ?? [],
    GROUP: groups.data ?? [],
    DEPARTMENT: departments.data ?? [],
    COMPANY: companies.data ?? [],
    SITE: sites.data ?? [],
  };
  const names = new Map<string, string>();
  for (const list of Object.values(records)) for (const record of list) names.set(record.id, record.name);
  for (const batch of people) for (const person of batch.data ?? []) names.set(person.userId, `${person.firstName} ${person.lastName}`);
  return { records, nameOf: (id: string | null) => (id === null ? undefined : names.get(id)) };
}
