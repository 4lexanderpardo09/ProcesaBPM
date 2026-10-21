import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApiClient } from '@/shared/session';
import { type DraftContentApi, draftContentApi } from '../api/draft-content-api';
import type { Builder } from './use-builder';

/** One edit of the draft's content: the call, and how its answer changes the canvas document. */
export interface ContentEdit<T> {
  readonly call: (api: DraftContentApi) => Promise<T>;
  readonly apply: (doc: WorkflowVersionDocument, result: T) => WorkflowVersionDocument;
}

/**
 * Edits of fields, lists of a block and amount rules. They wait for a canvas save in flight (both bump the revision), and
 * the canvas waits for them; an error stays on the mutation for the section that made it to explain.
 */
export function useDraftContent(builder: Builder, workflowId: string, versionId: string) {
  const client = useApiClient();
  const api = useMemo(() => draftContentApi(client, workflowId, versionId), [client, workflowId, versionId]);
  const mutation = useMutation({
    mutationFn: async (edit: ContentEdit<unknown>) => ({ edit, result: await edit.call(api) }),
    onSuccess: ({ edit, result }) => builder.applySaved((doc) => edit.apply(doc, result)),
  });
  return {
    /** Whether it went through; when not, `error` says why. */
    run: <T,>(edit: ContentEdit<T>): Promise<boolean> =>
      mutation.mutateAsync(edit as ContentEdit<unknown>).then(
        () => true,
        () => false,
      ),
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
  };
}

export type DraftContent = ReturnType<typeof useDraftContent>;
