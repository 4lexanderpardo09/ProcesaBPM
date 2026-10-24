import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { commentOnTicket } from '../api/ticket-detail-api';
import { ticketQueryKeys } from '../api/tickets-api';

/** Adds the editor's HTML as a comment, with its attachments, and reloads the activity and the ticket's files. */
export function useCommentOnTicket(ticketId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ html, attachments }: { readonly html: string; readonly attachments: readonly string[] }) => commentOnTicket(client, ticketId, html, attachments),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ticketQueryKeys.timeline(ticketId) }), queryClient.invalidateQueries({ queryKey: ticketQueryKeys.documents(ticketId) })]),
  });
}
