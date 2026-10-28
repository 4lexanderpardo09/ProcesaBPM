import type { AiDraftResult } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { ReactFlowProvider } from '@xyflow/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { paths } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Alert, ButtonLink } from '@/shared/ui';
import { versionDetailQueryOptions } from '../builder/api/builder-api';
import { WorkflowBuilder } from '../builder/components/WorkflowBuilder';
import styles from '../components/Workflows.module.css';

const NOT_FOUND = 404;

/** `/workflows/:workflowId/versions/:versionId`: the builder of that version (read only unless it is a draft). */
export function WorkflowBuilderPage() {
  const { workflowId = '', versionId = '' } = useParams();
  const { t } = useTranslation('workflows');
  const detail = useQuery(versionDetailQueryOptions(useApiClient(), workflowId, versionId));
  const [published, setPublished] = useState<number | null>(null);
  /** The draft was rewritten on the server (by the AI or a template): `aiResult` is null for a template. */
  const [replaced, setReplaced] = useState<{ readonly aiResult: AiDraftResult | null; readonly generation: number } | null>(null);
  /** Read the draft again and start the builder over on it. */
  const takeReplacement = (aiResult: AiDraftResult | null) => {
    void detail.refetch().then(() => setReplaced((current) => ({ aiResult, generation: (current?.generation ?? 0) + 1 })));
  };

  if (detail.isError) {
    return (
      <div className={styles.stack}>
        <Alert tone="danger">{detail.error instanceof ApiError && detail.error.status === NOT_FOUND ? t('builder.notFound') : t('loadFailed')}</Alert>
        <div>
          <ButtonLink to={paths.workflows}>{t('detail.back')}</ButtonLink>
        </div>
      </div>
    );
  }
  if (detail.data === undefined) return <p className={styles.note}>{t('builder.loading')}</p>;
  return (
    <>
      {published !== null && <Alert tone="ok">{t('builder.published', { number: published })}</Alert>}
      {replaced !== null && replaced.aiResult === null && <Alert tone="ok">{t('builder.templateImport.ready')}</Alert>}
      {replaced?.aiResult && <Alert tone="ok">{t('builder.ai.ready')}</Alert>}
      <ReactFlowProvider>
        {/* A publication turns the draft into the live version: the builder starts again on what the API now says. */}
        <WorkflowBuilder
          key={`${detail.data.version.id}-${detail.data.version.status}-${String(replaced?.generation ?? 0)}`}
          detail={detail.data}
          onPublished={setPublished}
          onAiDraft={takeReplacement}
          onTemplateImported={() => takeReplacement(null)}
          arrangeOnOpen={replaced !== null}
        />
      </ReactFlowProvider>
    </>
  );
}
