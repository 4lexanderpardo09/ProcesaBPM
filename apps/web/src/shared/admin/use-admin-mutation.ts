import { type QueryKey, useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { adminQueryKeys } from './admin-api';

/**
 * A change in an administration screen; once it succeeds, every administration list is read again, and so is what
 * other screens cache from the same data (`alsoInvalidates`, e.g. the new-ticket form for the catalog).
 */
export function useAdminMutation<TArgs, TResult = unknown>(action: (client: HttpClient, args: TArgs) => Promise<TResult>, alsoInvalidates: readonly QueryKey[] = []) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(client, args),
    onSuccess: async () => {
      await Promise.all([adminQueryKeys.all, ...alsoInvalidates].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
