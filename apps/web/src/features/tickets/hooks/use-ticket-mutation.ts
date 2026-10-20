import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { ticketQueryKeys } from '../api/tickets-api';

/** An action on a ticket; once it succeeds, everything about tickets is read again (detail, activity, flow, inbox and counts). */
export function useTicketMutation<TArgs>(action: (client: HttpClient, args: TArgs) => Promise<unknown>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(client, args),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketQueryKeys.all }),
  });
}
