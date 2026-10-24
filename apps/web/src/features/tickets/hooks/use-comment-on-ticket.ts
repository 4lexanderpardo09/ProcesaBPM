import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { commentOnTicket } from '../api/ticket-detail-api';
import { ticketQueryKeys } from '../api/tickets-api';

/** Adds the editor's HTML as a comment and reloads the activity. */
export function useCommentOnTicket(ticketId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (html: string) => commentOnTicket(client, ticketId, html),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketQueryKeys.timeline(ticketId) }),
  });
}
