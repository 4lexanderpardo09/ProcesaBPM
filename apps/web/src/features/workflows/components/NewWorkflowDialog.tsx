import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button, Dialog, Select, TextField } from '@/shared/ui';
import { allWorkflowsQueryOptions, createWorkflow, subcategoryChoicesQueryOptions, workflowQueryKeys } from '../api/workflows-api';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

const NAME_MAX = 200;

/** A workflow for a subcategory that has none yet; its name starts as the subcategory's. */
export function NewWorkflowDialog({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (workflowId: string) => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const choices = useQuery(subcategoryChoicesQueryOptions(client));
  const existing = useQuery(allWorkflowsQueryOptions(client));
  const [subcategoryId, setSubcategoryId] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: () => createWorkflow(client, { subcategoryId, name: name.trim() }),
    onSuccess: async (workflow) => {
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
      onCreated(workflow.id);
    },
  });

  const taken = new Set((existing.data ?? []).map((workflow) => workflow.subcategory.id));
  const available = choices.data?.filter((choice) => !taken.has(choice.id));
  const loading = available === undefined || existing.data === undefined;
  const subcategoryError = submitted && subcategoryId === '' ? t('create.pickSubcategory') : undefined;
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;

  return (
    <Dialog
      open
      title={t('create.title')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (subcategoryId === '' || name.trim() === '' || create.isPending) return;
        create.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={create.isPending || loading || available.length === 0}>
            {create.isPending ? t('saving') : t('create.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        {loading ? (
          <p className={styles.note}>{choices.isError || existing.isError ? t('loadFailed') : t('loading')}</p>
        ) : available.length === 0 ? (
          <p className={styles.note}>{t('create.noneLeft')}</p>
        ) : (
          <>
            <Select
              label={t('create.subcategory')}
              hint={t('create.subcategoryHint')}
              error={subcategoryError}
              required
              placeholder={t('create.subcategoryPlaceholder')}
              options={available.map((choice) => ({ value: choice.id, label: t('list.subcategoryPath', { category: choice.categoryName, subcategory: choice.name }) }))}
              value={subcategoryId}
              onChange={(event) => {
                const id = event.target.value;
                setSubcategoryId(id);
                if (!nameTouched) setName(available.find((choice) => choice.id === id)?.name ?? '');
              }}
            />
            <TextField
              label={t('create.name')}
              required
              maxLength={NAME_MAX}
              error={nameError}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
            />
          </>
        )}
        <WorkflowError error={create.error} context="createWorkflow" />
      </div>
    </Dialog>
  );
}
