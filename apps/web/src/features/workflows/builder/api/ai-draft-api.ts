import { aiAvailabilityResponseSchema, aiDraftRequestedSchema, aiJobResponseSchema, type AiJobResponse, type RequestAiDraft } from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

/** How often a running request is checked: the model takes between half a minute and a few minutes. */
export const AI_JOB_POLL_MS = 3_000;

export const aiDraftQueryKeys = {
  availability: (versionId: string) => ['ai-assistant', 'availability', versionId] as const,
  job: (jobId: string) => ['ai-assistant', 'jobs', jobId] as const,
};

export const isAiJobOpen = (job: AiJobResponse | undefined): boolean => job === undefined || job.status === 'PENDING' || job.status === 'RUNNING';

export function aiAvailabilityQueryOptions(client: HttpClient, versionId: string) {
  return queryOptions({
    queryKey: aiDraftQueryKeys.availability(versionId),
    queryFn: ({ signal }) => client.request(`/ai-assistant/availability?versionId=${encodeURIComponent(versionId)}`, { schema: aiAvailabilityResponseSchema, signal }),
  });
}

export function aiJobQueryOptions(client: HttpClient, jobId: string) {
  return queryOptions({
    queryKey: aiDraftQueryKeys.job(jobId),
    queryFn: ({ signal }) => client.request(`/ai-jobs/${encodeURIComponent(jobId)}`, { schema: aiJobResponseSchema, signal }),
    refetchInterval: (query) => (isAiJobOpen(query.state.data) ? AI_JOB_POLL_MS : false),
  });
}

export function requestAiDraft(client: HttpClient, workflowId: string, versionId: string, body: RequestAiDraft) {
  return client.request(`/workflows/${encodeURIComponent(workflowId)}/versions/${encodeURIComponent(versionId)}/ai-draft`, { method: 'POST', body, schema: aiDraftRequestedSchema });
}
