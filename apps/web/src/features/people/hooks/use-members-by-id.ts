import type { MemberResponse } from '@procesabpm/shared';
import { useQueries } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { memberQueryOptions } from '../api/people-api';

/**
 * The members behind a list of user ids (group members, approvers, delegations), each read once and cached a
 * minute. `loading` until every one has answered; one that cannot be read is left out.
 */
export function useMembersById(userIds: readonly string[]): { readonly byId: ReadonlyMap<string, MemberResponse>; readonly loading: boolean } {
  const client = useApiClient();
  const queries = useQueries({ queries: [...new Set(userIds)].map((userId) => memberQueryOptions(client, userId)) });
  return {
    byId: new Map(queries.flatMap((query) => (query.data === undefined ? [] : [[query.data.userId, query.data] as const]))),
    loading: queries.some((query) => query.isPending),
  };
}
