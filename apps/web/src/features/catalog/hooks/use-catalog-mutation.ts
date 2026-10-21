import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { catalogQueryKeys } from '../api/catalog-api';

/** What creating a ticket caches from the catalog (available categories, priorities): it changes with it. */
const TICKET_FORM_KEYS = [['catalog', 'available'], ['priorities']] as const;

/** A change to the catalog; once it succeeds, the catalog lists and the new-ticket form read it again. */
export function useCatalogMutation<TArgs, TResult = unknown>(action: (client: HttpClient, args: TArgs) => Promise<TResult>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(client, args),
    onSuccess: async () => {
      await Promise.all([catalogQueryKeys.all, ...TICKET_FORM_KEYS].map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
  });
}
