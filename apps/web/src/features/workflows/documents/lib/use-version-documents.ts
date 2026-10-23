import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/shared/session';
import { workflowQueryOptions } from '../../api/workflows-api';
import { versionDetailQueryOptions } from '../../builder/api/builder-api';

const EMPTY_DOCUMENT: WorkflowVersionDocument = { steps: [], transitions: [], fields: [], amountRules: [] };

/**
 * The versions a workflow's documents are checked against: `current`, the one tickets run on (the published one, or
 * the draft while there is none), and `upcoming`, the draft that will replace it. `ready` once both are read.
 */
export function useVersionDocuments(workflowId: string) {
  const client = useApiClient();
  const workflow = useQuery(workflowQueryOptions(client, workflowId));
  const published = workflow.data?.versions.find((version) => version.status === 'PUBLISHED');
  const draft = workflow.data?.versions.find((version) => version.status === 'DRAFT');
  const publishedDoc = useQuery({ ...versionDetailQueryOptions(client, workflowId, published?.id ?? ''), enabled: published !== undefined });
  const draftDoc = useQuery({ ...versionDetailQueryOptions(client, workflowId, draft?.id ?? ''), enabled: draft !== undefined });
  const ready = workflow.data !== undefined && (published === undefined || publishedDoc.data !== undefined) && (draft === undefined || draftDoc.data !== undefined);
  return {
    workflow,
    ready,
    current: publishedDoc.data?.document ?? draftDoc.data?.document ?? EMPTY_DOCUMENT,
    upcoming: publishedDoc.data === undefined ? undefined : draftDoc.data?.document,
  };
}
