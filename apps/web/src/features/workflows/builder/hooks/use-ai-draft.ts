import type { AiDraftResult, AiJobHistoryItem } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useRealtimeClient, useRealtimeConnected, useRealtimeEvent } from '@/shared/realtime';
import { useApiClient } from '@/shared/session';
import { aiAvailabilityQueryOptions, aiDraftQueryKeys, aiHistoryQueryOptions, cancelAiJob, isOpen, requestAiDraft } from '../api/ai-draft-api';

/**
 * «Crear con IA» in one draft: whether it is offered, the history of its requests (with the one in progress, if any),
 * and sending or cancelling one. The socket says when a request moved and the history is read again; without it, an
 * open request is polled. A request seen open here that ends SUCCEEDED hands its result to `onReady` once.
 */
export function useAiDraft(workflowId: string, versionId: string, enabled: boolean, onReady: (result: AiDraftResult) => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const realtime = useRealtimeClient();
  const live = useRealtimeConnected();
  const availability = useQuery({ ...aiAvailabilityQueryOptions(client, versionId), enabled });
  const history = useQuery({ ...aiHistoryQueryOptions(client, workflowId, versionId, live), enabled: enabled && availability.data?.available === true });
  const jobs = history.data?.jobs ?? [];
  const active = jobs.findLast((job) => isOpen(job.status));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: aiDraftQueryKeys.history(versionId) });
  useEffect(() => (enabled ? realtime?.followAiDraft(versionId) : undefined), [realtime, versionId, enabled]);
  useRealtimeEvent('ai_job.changed', (payload) => {
    if (payload.versionId === versionId) refresh();
  });
  useRealtimeEvent('sync.required', ({ delayMs }) => window.setTimeout(refresh, delayMs));
  // A (re)connection may have missed signals.
  useEffect(() => {
    if (live && enabled) refresh();
  }, [live]);

  const watch = useEndedRequests(jobs, (job) => {
    void queryClient.invalidateQueries({ queryKey: aiDraftQueryKeys.availability(versionId) });
    if (job.status === 'SUCCEEDED' && job.result !== null) onReady(job.result);
  });

  const request = useMutation({
    mutationFn: (body: { description: string; revision: number }) => requestAiDraft(client, workflowId, versionId, body),
    onSuccess: ({ jobId }) => watch(jobId),
    onSettled: refresh,
  });
  const cancel = useMutation({ mutationFn: (jobId: string) => cancelAiJob(client, jobId), onSettled: refresh });

  return {
    available: availability.data?.available === true,
    remainingToday: availability.data?.remainingJobsToday ?? 0,
    jobs,
    loading: history.isPending && history.fetchStatus !== 'idle',
    active,
    live,
    request,
    cancel,
  };
}

export type AiDraft = ReturnType<typeof useAiDraft>;

/**
 * Calls `onEnded` once for each request this screen saw open (or sent: it may end before the next read) and now sees
 * finished. Returns how to watch a request just sent.
 */
function useEndedRequests(jobs: readonly AiJobHistoryItem[], onEnded: (job: AiJobHistoryItem) => void): (jobId: string) => void {
  const seenOpen = useRef(new Set<string>());
  useEffect(() => {
    for (const job of jobs) {
      if (isOpen(job.status)) seenOpen.current.add(job.id);
      else if (seenOpen.current.delete(job.id)) onEnded(job);
    }
  }, [jobs]);
  return (jobId) => seenOpen.current.add(jobId);
}
