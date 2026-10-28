import { aiAvailabilityResponseSchema, aiDraftRequestedSchema, aiJobHistoryResponseSchema, type AiJobHistoryResponse, aiJobResponseSchema, type RequestAiDraft } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

/**
 * How often an open request is read again: rarely while the socket brings its changes, often enough without one
 * (no socket, or it is reconnecting) for the progress to move.
 */
export const AI_HISTORY_POLL_MS = { live: 30_000, offline: 5_000 } as const;

export const aiDraftQueryKeys = {
  availability: (versionId: string) => ['ai-assistant', 'availability', versionId] as const,
  history: (versionId: string) => ['ai-assistant', 'history', versionId] as const,
};

export const isOpen = (status: string): boolean => status === 'PENDING' || status === 'RUNNING';
export const hasOpenJob = (history: AiJobHistoryResponse | undefined): boolean => history?.jobs.some((job) => isOpen(job.status)) ?? false;

export function aiAvailabilityQueryOptions(client: HttpClient, versionId: string) {
  return queryOptions({
    queryKey: aiDraftQueryKeys.availability(versionId),
    queryFn: ({ signal }) => client.request(`/ai-assistant/availability?versionId=${encodeURIComponent(versionId)}`, { schema: aiAvailabilityResponseSchema, signal }),
  });
}

export function aiHistoryQueryOptions(client: HttpClient, workflowId: string, versionId: string, live: boolean) {
  return queryOptions({
    queryKey: aiDraftQueryKeys.history(versionId),
    queryFn: ({ signal }) => client.request(`${draftPath(workflowId, versionId)}/ai-jobs`, { schema: aiJobHistoryResponseSchema, signal }),
    refetchInterval: (query) => (hasOpenJob(query.state.data) ? (live ? AI_HISTORY_POLL_MS.live : AI_HISTORY_POLL_MS.offline) : false),
  });
}

export function requestAiDraft(client: HttpClient, workflowId: string, versionId: string, body: RequestAiDraft) {
  return client.request(`${draftPath(workflowId, versionId)}/ai-draft`, { method: 'POST', body, schema: aiDraftRequestedSchema });
}

export function cancelAiJob(client: HttpClient, jobId: string) {
  return client.request(`/ai-jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', body: {}, schema: aiJobResponseSchema });
}

const draftPath = (workflowId: string, versionId: string) => `/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}`;
