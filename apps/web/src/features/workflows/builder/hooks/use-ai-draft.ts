import type { AiDraftResult } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useApiClient } from '@/shared/session';
import { aiAvailabilityQueryOptions, aiDraftQueryKeys, aiJobQueryOptions, requestAiDraft } from '../api/ai-draft-api';

/**
 * «Crear con IA» in one draft: whether it is offered, the request in flight (picked up again if the builder is
 * reopened while it runs), and its outcome. The request keeps being followed with the dialog closed.
 */
export function useAiDraft(workflowId: string, versionId: string, enabled: boolean, onReady: (result: AiDraftResult) => void) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const availability = useQuery({ ...aiAvailabilityQueryOptions(client, versionId), enabled });
  const [jobId, setJobId] = useState<string | null>(null);
  const followed = jobId ?? availability.data?.activeJobId ?? null;
  const job = useQuery({ ...aiJobQueryOptions(client, followed ?? ''), enabled: followed !== null });

  const request = useMutation({
    mutationFn: (body: { description: string; revision: number }) => requestAiDraft(client, workflowId, versionId, body),
    onSuccess: ({ jobId: created }) => setJobId(created),
  });

  const status = job.data?.status;
  const result = job.data?.result;
  useEffect(() => {
    if (status === 'SUCCEEDED' && result !== null && result !== undefined) {
      void queryClient.invalidateQueries({ queryKey: aiDraftQueryKeys.availability(versionId) });
      onReady(result);
    }
    // Once per finished request: only the status change matters.
  }, [status]);

  return {
    available: availability.data?.available === true,
    remainingToday: availability.data?.remainingJobsToday ?? 0,
    job: followed === null ? undefined : job.data,
    request,
    /** Back to the form after a failure, to try again. */
    reset: () => {
      setJobId(null);
      request.reset();
      void queryClient.invalidateQueries({ queryKey: aiDraftQueryKeys.availability(versionId) });
    },
  };
}

export type AiDraft = ReturnType<typeof useAiDraft>;
