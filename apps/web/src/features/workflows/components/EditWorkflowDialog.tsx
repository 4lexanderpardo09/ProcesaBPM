import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button, Checkbox, Dialog, TextField } from '@/shared/ui';
import { updateWorkflow, type WorkflowDetail, workflowQueryKeys } from '../api/workflows-api';
import { WorkflowError } from './WorkflowError';
import styles from './Workflows.module.css';

const NAME_MAX = 200;

/** The name, and whether new tickets can be created with it (the subcategory never changes). */
export function EditWorkflowDialog({ workflow, onClose }: { readonly workflow: WorkflowDetail; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(workflow.name);
  const [isActive, setIsActive] = useState(workflow.isActive);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => updateWorkflow(client, workflow.id, { name: name.trim(), isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(workflowQueryKeys.detail(workflow.id), saved);
      await queryClient.invalidateQueries({ queryKey: workflowQueryKeys.all });
      onClose();
    },
  });
  const nameError = submitted && name.trim() === '' ? t('create.nameRequired') : undefined;
  return (
    <Dialog
      open
      title={t('editDialog.title')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (name.trim() !== '' && !save.isPending) save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <TextField label={t('editDialog.name')} required maxLength={NAME_MAX} error={nameError} value={name} onChange={(event) => setName(event.target.value)} />
        <Checkbox label={t('editDialog.active')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        <WorkflowError error={save.error} context="updateWorkflow" />
      </div>
    </Dialog>
  );
}
