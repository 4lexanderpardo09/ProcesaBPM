import type { AiFormatJob, AiFormatResult, RequestAiFormat } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useApiClient } from '@/shared/session';
import { cancelAiJob, isOpen } from '../../builder/api/ai-draft-api';
import { formatAiAvailabilityQueryOptions, formatAiHistoryQueryOptions, formatAiQueryKeys, requestFormatAi } from '../api/format-ai-api';

/**
 * Jiro in one format: whether it is offered, the history of its requests (polled while one is open), and sending or
 * cancelling one. A request seen open here that ends SUCCEEDED hands its result to `onReady` once: the designer puts
 * the design on the canvas as an unsaved, undoable change.
 */
export function useFormatAi(workflowId: string, formatId: string, enabled: boolean, onReady: (result: AiFormatResult) => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const availability = useQuery({ ...formatAiAvailabilityQueryOptions(client, workflowId, formatId), enabled });
  const history = useQuery({ ...formatAiHistoryQueryOptions(client, workflowId, formatId), enabled: enabled && availability.data?.available === true });
  const jobs = history.data?.jobs ?? [];
  const active = jobs.findLast((job) => isOpen(job.status));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: formatAiQueryKeys.history(formatId) });

  const seenOpen = useRef(new Set<string>());
  useEffect(() => {
    for (const job of jobs) {
      if (isOpen(job.status)) seenOpen.current.add(job.id);
      else if (seenOpen.current.delete(job.id)) {
        void queryClient.invalidateQueries({ queryKey: formatAiQueryKeys.availability(formatId) });
        if (job.status === 'SUCCEEDED' && job.result !== null) onReady(job.result);
      }
    }
  }, [jobs]);

  const request = useMutation({
    mutationFn: (body: RequestAiFormat) => requestFormatAi(client, workflowId, formatId, body),
    // It may end before the next read: watch it from now.
    onSuccess: ({ jobId }) => void seenOpen.current.add(jobId),
    onSettled: refresh,
  });
  const cancel = useMutation({ mutationFn: (jobId: string) => cancelAiJob(client, jobId), onSettled: refresh });

  return {
    available: availability.data?.available === true,
    remainingToday: availability.data?.remainingJobsToday ?? 0,
    jobs,
    loading: history.isPending && history.fetchStatus !== 'idle',
    active,
    request,
    cancel,
  };
}

export type FormatAi = ReturnType<typeof useFormatAi>;
export type { AiFormatJob };
