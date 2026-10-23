import { useMutation } from '@tanstack/react-query';
import { openDownload } from '@/shared/lib/open-download';
import { useApiClient } from '@/shared/session';
import { ticketFileDownloadUrl } from '../api/ticket-detail-api';

/** Downloads a file of the ticket: the short-lived link is asked for at the moment of the click. */
export function useTicketFileDownload(ticketId: string) {
  const client = useApiClient();
  return useMutation({
    mutationFn: (fileId: string) => ticketFileDownloadUrl(client, ticketId, fileId),
    onSuccess: ({ url }) => openDownload(url),
  });
}
