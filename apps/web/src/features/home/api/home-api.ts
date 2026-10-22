import type { DashboardStatsResponse, PendingTicketResponse } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import { z } from 'zod';
import type { HttpClient } from '@/shared/api';

const count = z.number().int().min(0);
const statsSchema = z.object({ myOpen: count, myOverdue: count, myDueSoon: count, createdByMeOpen: count, closedByMeWeek: count }) satisfies z.ZodType<DashboardStatsResponse>;
const pendingSchema = z.array(
  z.object({
    id: z.string(),
    number: z.string(),
    title: z.string(),
    status: z.enum(['OPEN', 'PAUSED', 'CLOSED']),
    currentStepId: z.string().nullable(),
    createdAt: z.string(),
    dueAt: z.string().nullable(),
    overdue: z.boolean(),
  }),
) satisfies z.ZodType<PendingTicketResponse[]>;

export type HomeStats = z.infer<typeof statsSchema>;
export type PendingTicket = z.infer<typeof pendingSchema>[number];

/** Under `tickets`, so anything that changes a ticket refreshes the home too. */
export const homeQueryKeys = {
  stats: ['tickets', 'home', 'stats'] as const,
  pending: ['tickets', 'home', 'pending'] as const,
};

export function homeStatsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: homeQueryKeys.stats, queryFn: ({ signal }) => client.request('/dashboard/stats', { schema: statsSchema, signal }) });
}

export function pendingTicketsQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: homeQueryKeys.pending, queryFn: ({ signal }) => client.request('/dashboard/pending', { schema: pendingSchema, signal }) });
}
