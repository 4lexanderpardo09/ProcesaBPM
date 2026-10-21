import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Button, Checkbox, Dialog, TextField } from '@/shared/ui';
import { type Dataset, datasetQueryKeys, deleteDataset, updateDataset } from '../api/datasets-api';
import { DatasetError } from './DatasetError';
import styles from './Datasets.module.css';

const NAME_MAX = 200;

/** The name, and whether it is in use: while inactive, the forms whose fields read it offer nothing from it. */
export function EditDatasetDialog({ dataset, onClose }: { readonly dataset: Dataset; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [name, setName] = useState(dataset.name);
  const [isActive, setIsActive] = useState(dataset.isActive);
  const [submitted, setSubmitted] = useState(false);
  const save = useMutation({
    mutationFn: () => updateDataset(client, dataset.id, { name: name.trim(), isActive }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(datasetQueryKeys.detail(dataset.id), saved);
      await queryClient.invalidateQueries({ queryKey: datasetQueryKeys.all });
      onClose();
    },
  });
  const nameError = submitted && name.trim() === '' ? t('datasets.load.nameRequired') : undefined;
  return (
    <Dialog
      open
      title={t('datasets.edit.title')}
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
        <TextField label={t('datasets.load.name')} required maxLength={NAME_MAX} error={nameError} value={name} onChange={(event) => setName(event.target.value)} />
        <Checkbox label={t('datasets.edit.active')} checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
        {!isActive && <p className={styles.note}>{t('datasets.edit.inactiveHint')}</p>}
        <DatasetError error={save.error} context="save" />
      </div>
    </Dialog>
  );
}

/** Only a dataset no field uses (in any version); the API says so otherwise, and deactivating it is the way out. */
export function DeleteDatasetDialog({ dataset, onClose, onDeleted }: { readonly dataset: Dataset; readonly onClose: () => void; readonly onDeleted: () => void }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteDataset(client, dataset.id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: datasetQueryKeys.detail(dataset.id) });
      await queryClient.invalidateQueries({ queryKey: datasetQueryKeys.all });
      onDeleted();
    },
  });
  return (
    <Dialog
      open
      title={t('datasets.delete.title')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="brand" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? t('saving') : t('datasets.delete.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        <p className={styles.note}>{t('datasets.delete.body', { name: dataset.name })}</p>
        <DatasetError error={remove.error} context="delete" />
      </div>
    </Dialog>
  );
}
