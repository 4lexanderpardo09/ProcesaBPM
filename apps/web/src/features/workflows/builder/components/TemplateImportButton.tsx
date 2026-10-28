import type { ImportDraftSpecRequest } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Dialog } from '@/shared/ui';
import { importDraftSpec } from '../api/builder-api';

type ImportProblem = 'notJson' | 'notTemplate' | 'doesNotFit' | 'stale' | 'failed';

/** Why the server refused the template, in the words the dialog uses. */
function problemOf(error: unknown): ImportProblem {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'STALE_REVISION') return 'stale';
  if (error.code === 'VALIDATION_FAILED') return (error.details as { problems?: unknown } | undefined)?.problems === undefined ? 'notTemplate' : 'doesNotFit';
  return 'failed';
}

/**
 * «Importar plantilla»: a JSON file in the format «Crear con IA» uses replaces the whole draft (no AI involved). The
 * names of positions, groups and approval types in it must exist in the organization.
 */
export function TemplateImportButton({ workflowId, versionId, revision, disabled, onImported }: { readonly workflowId: string; readonly versionId: string; readonly revision: number; readonly disabled: boolean; readonly onImported: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<ImportProblem | null>(null);
  const upload = useMutation({
    mutationFn: (body: ImportDraftSpecRequest) => importDraftSpec(client, workflowId, versionId, body),
    onSuccess: onImported,
    onError: (error) => setProblem(problemOf(error)),
  });

  const read = async (file: File) => {
    let spec: unknown;
    try {
      spec = JSON.parse(await file.text());
    } catch {
      setProblem('notJson');
      return;
    }
    upload.mutate({ revision, spec: spec as ImportDraftSpecRequest['spec'] });
  };

  return (
    <>
      <Button disabled={disabled || upload.isPending} title={disabled ? t('builder.ai.saveFirst') : undefined} onClick={() => input.current?.click()}>
        {upload.isPending ? t('builder.templateImport.importing') : t('builder.templateImport.open')}
      </Button>
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label={t('builder.templateImport.file')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file !== undefined) void read(file);
        }}
      />
      {problem !== null && (
        <Dialog open title={t('builder.templateImport.failedTitle')} closeLabel={t('close')} onClose={() => setProblem(null)} footer={<Button onClick={() => setProblem(null)}>{t('close')}</Button>}>
          <Alert tone="danger">{t(`builder.templateImport.problems.${problem}`)}</Alert>
        </Dialog>
      )}
    </>
  );
}
