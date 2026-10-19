import { useMutation, useQueryClient } from '@tanstack/react-query';
import { plainTextToHtml } from '@/shared/lib/plain-text-html';
import { useApiClient } from '@/shared/session';
import { commentOnTicket } from '../api/ticket-detail-api';
import { ticketQueryKeys } from '../api/tickets-api';

/** Adds what the person typed as a comment and reloads the activity. */
export function useCommentOnTicket(ticketId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => commentOnTicket(client, ticketId, plainTextToHtml(text)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ticketQueryKeys.timeline(ticketId) }),
  });
}
