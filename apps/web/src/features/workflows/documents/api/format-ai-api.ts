import { aiAvailabilityResponseSchema, aiDraftRequestedSchema, aiFormatHistoryResponseSchema, type AiFormatHistoryResponse, type RequestAiFormat } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';
import { isOpen } from '../../builder/api/ai-draft-api';

/** A format request is polled while open: the socket follows workflow drafts only, and a format takes about a minute. */
export const FORMAT_AI_POLL_MS = 2_000;

export const formatAiQueryKeys = {
  availability: (formatId: string) => ['format-ai', 'availability', formatId] as const,
  history: (formatId: string) => ['format-ai', 'history', formatId] as const,
};

const hasOpenJob = (history: AiFormatHistoryResponse | undefined): boolean => history?.jobs.some((job) => isOpen(job.status)) ?? false;
const formatPath = (workflowId: string, formatId: string) => `/workflows/${encodeURIComponent(workflowId)}/pdf-formats/${encodeURIComponent(formatId)}`;

export function formatAiAvailabilityQueryOptions(client: HttpClient, workflowId: string, formatId: string) {
  return queryOptions({
    queryKey: formatAiQueryKeys.availability(formatId),
    queryFn: ({ signal }) => client.request(`${formatPath(workflowId, formatId)}/ai-assistant`, { schema: aiAvailabilityResponseSchema, signal }),
  });
}

export function formatAiHistoryQueryOptions(client: HttpClient, workflowId: string, formatId: string) {
  return queryOptions({
    queryKey: formatAiQueryKeys.history(formatId),
    queryFn: ({ signal }) => client.request(`${formatPath(workflowId, formatId)}/ai-jobs`, { schema: aiFormatHistoryResponseSchema, signal }),
    refetchInterval: (query) => (hasOpenJob(query.state.data) ? FORMAT_AI_POLL_MS : false),
  });
}

export function requestFormatAi(client: HttpClient, workflowId: string, formatId: string, body: RequestAiFormat) {
  return client.request(`${formatPath(workflowId, formatId)}/ai-draft`, { method: 'POST', body, schema: aiDraftRequestedSchema });
}
