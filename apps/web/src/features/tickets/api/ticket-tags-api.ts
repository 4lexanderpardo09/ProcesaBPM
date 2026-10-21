import type { HttpClient } from '@/shared/api';

const tagsUrl = (ticketId: string) => `/tickets/${encodeURIComponent(ticketId)}/tags`;

/** Puts one of the caller's own tags on the ticket; nobody else sees it. */
export function attachTicketTag(client: HttpClient, ticketId: string, tagId: string) {
  return client.request(tagsUrl(ticketId), { method: 'POST', body: { tagId } });
}

export function detachTicketTag(client: HttpClient, ticketId: string, tagId: string) {
  return client.request(`${tagsUrl(ticketId)}/${encodeURIComponent(tagId)}`, { method: 'DELETE' });
}
