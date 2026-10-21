import type { WorkflowVersionDocument } from '@procesabpm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useApiClient } from '@/shared/session';
import { workflowQueryKeys } from '../../api/workflows-api';
import { builderQueryKeys, saveGraph, type VersionDetail } from '../api/builder-api';
import { remapSelection, type Selection, toSaveRequest, validateDraft } from '../lib/builder-doc';

/**
 * The canvas being edited: the document as the person left it, the revision it was read at, whether something is not
 * saved yet and what is selected. Validation runs on every change with the same rules the API applies to a draft.
 */
export function useBuilder(detail: VersionDetail) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [doc, setDocState] = useState<WorkflowVersionDocument>(detail.document);
  const [revision, setRevision] = useState(detail.version.revision);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const validation = useMemo(() => validateDraft(doc), [doc]);

  const change = useCallback((next: (current: WorkflowVersionDocument) => WorkflowVersionDocument) => {
    setDocState(next);
    setDirty(true);
  }, []);

  const save = useMutation({
    mutationFn: () => saveGraph(client, detail.workflow.id, detail.version.id, toSaveRequest(doc, revision)),
    onSuccess: (saved) => {
      setDocState(saved.document);
      setRevision(saved.revision);
      setDirty(false);
      setSelection((current) => remapSelection(current, saved.idMap));
      queryClient.setQueryData<VersionDetail>(builderQueryKeys.version(detail.workflow.id, detail.version.id), (current) =>
        current === undefined ? current : { ...current, document: saved.document, version: { ...current.version, revision: saved.revision }, validation: saved.validation },
      );
      // The workflow's page shows the revision; the canvas itself is never read again behind the person's back.
      void queryClient.invalidateQueries({ queryKey: workflowQueryKeys.detail(detail.workflow.id), exact: true });
    },
  });

  return { doc, change, revision, dirty, selection, setSelection, validation, save };
}

export type Builder = ReturnType<typeof useBuilder>;
