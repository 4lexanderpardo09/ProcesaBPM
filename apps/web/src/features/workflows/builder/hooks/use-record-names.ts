import { MEMBER_DIRECTORY_LIMIT } from '@procesabpm/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
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

  // When each batch of names last arrived: a fixed-size key for the memo below.
  const peopleKey = people.map((batch) => batch.dataUpdatedAt).join(',');
  // Stable while the lists do not change: the canvas rebuilds its blocks only when a name arrives.
  const records = useMemo<Readonly<Record<Exclude<RecordKind, 'USER'>, readonly NamedRecord[]>>>(
    () => ({ POSITION: positions.data ?? [], GROUP: groups.data ?? [], DEPARTMENT: departments.data ?? [], COMPANY: companies.data ?? [], SITE: sites.data ?? [] }),
    [positions.data, groups.data, departments.data, companies.data, sites.data],
  );
  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const list of Object.values(records)) for (const record of list) names.set(record.id, record.name);
    for (const batch of people) for (const person of batch.data ?? []) names.set(person.userId, `${person.firstName} ${person.lastName}`);
    return (id: string | null) => (id === null ? undefined : names.get(id));
    // `people` is read through `peopleKey`: the array itself is new on every render.
  }, [records, peopleKey]);
  return { records, nameOf };
}
