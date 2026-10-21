import { DATASET_MAX_COLUMNS, DATASET_MAX_ROWS, MAX_FILE_BYTES } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadFiles } from '@/shared/files/upload-files';
import { formatFileSize } from '@/shared/lib/format-file-size';
import { useApiClient } from '@/shared/session';
import { Button, Dialog, Select, TextField } from '@/shared/ui';
import { allWorkflowsQueryOptions } from '../../api/workflows-api';
import { createDataset, DATASET_UPLOAD_ROUTES, type Dataset, datasetQueryKeys, reloadDataset } from '../api/datasets-api';
import { DatasetError } from './DatasetError';
import styles from './Datasets.module.css';

const NAME_MAX = 200;
const XLSX = '.xlsx';
const ALL_WORKFLOWS = '';

export interface LoadDatasetDialogProps {
  /** The dataset whose rows a new file replaces; without it, a new dataset. */
  readonly dataset?: Dataset;
  /** Once loaded, when the person closes the dialog (a new dataset is opened then). */
  readonly onClose: (loaded: Dataset | undefined) => void;
}

type FileRefusal = 'notXlsx' | 'tooBig';

/**
 * Loads an Excel file in two steps: first the file (uploaded, then read by the API, which says what it found), then,
 * optionally, the column that identifies each row. The key needs the column names, which only the API's reading knows;
 * the same upload is read again with it, so nothing is uploaded twice.
 */
export function LoadDatasetDialog({ dataset, onClose }: LoadDatasetDialogProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const inputId = useId();
  const creating = dataset === undefined;
  const workflows = useQuery({ ...allWorkflowsQueryOptions(client), enabled: creating });
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [workflowId, setWorkflowId] = useState(ALL_WORKFLOWS);
  const [file, setFile] = useState<File>();
  const [refusal, setRefusal] = useState<FileRefusal>();
  const [submitted, setSubmitted] = useState(false);
  const [loaded, setLoaded] = useState<{ readonly fileId: string; readonly dataset: Dataset }>();
  const [keyColumn, setKeyColumn] = useState('');

  const remember = async (saved: Dataset) => {
    queryClient.setQueryData(datasetQueryKeys.detail(saved.id), saved);
    await queryClient.invalidateQueries({ queryKey: datasetQueryKeys.all });
  };
  const load = useMutation({
    mutationFn: async (chosen: File) => {
      const [uploaded] = await uploadFiles(client, [chosen], fetch, DATASET_UPLOAD_ROUTES);
      const fileId = uploaded!.id;
      const saved = creating ? await createDataset(client, { name: name.trim(), fileId, ...(workflowId === ALL_WORKFLOWS ? {} : { workflowId }) }) : await reloadDataset(client, dataset.id, { fileId });
      return { fileId, dataset: saved };
    },
    onSuccess: async (result) => {
      await remember(result.dataset);
      setLoaded(result);
      setKeyColumn(result.dataset.keyColumn ?? '');
    },
  });
  const setKey = useMutation({
    mutationFn: (column: string) => reloadDataset(client, loaded!.dataset.id, { fileId: loaded!.fileId, keyColumn: column }),
    onSuccess: async (saved) => {
      await remember(saved);
      setLoaded((current) => (current === undefined ? current : { ...current, dataset: saved }));
    },
  });

  const close = () => onClose(loaded?.dataset);
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    if (chosen === undefined) return;
    const problem: FileRefusal | undefined = !chosen.name.toLowerCase().endsWith(XLSX) ? 'notXlsx' : chosen.size > MAX_FILE_BYTES ? 'tooBig' : undefined;
    setRefusal(problem);
    setFile(problem === undefined ? chosen : undefined);
    if (problem === undefined && creating && !nameTouched) setName(chosen.name.slice(0, -XLSX.length).slice(0, NAME_MAX));
    load.reset();
  };

  if (loaded !== undefined) {
    const current = loaded.dataset;
    const changed = keyColumn !== '' && keyColumn !== current.keyColumn;
    return (
      <Dialog
        open
        title={creating ? t('datasets.load.createTitle') : t('datasets.load.reloadTitle')}
        closeLabel={t('close')}
        onClose={close}
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !setKey.isPending) setKey.mutate(keyColumn);
          else close();
        }}
        footer={
          changed ? (
            <>
              <Button onClick={close}>{t('datasets.load.skipKey')}</Button>
              <Button type="submit" variant="brand" disabled={setKey.isPending}>
                {setKey.isPending ? t('saving') : t('datasets.load.saveKey')}
              </Button>
            </>
          ) : (
            <Button type="submit" variant="brand">
              {t('datasets.load.done')}
            </Button>
          )
        }
      >
        <div className={styles.fields}>
          <p className={styles.success} role="status">
            {t('datasets.load.loaded', { rows: current.rowCount, columns: current.columns.length, count: current.rowCount })}
          </p>
          <Select
            label={t('datasets.load.keyColumn')}
            hint={t('datasets.load.keyHint')}
            {...(current.keyColumn === null ? { placeholder: t('datasets.load.noKey') } : {})}
            options={current.columns.map((column) => ({ value: column.name, label: column.name }))}
            value={keyColumn}
            onChange={(event) => {
              setKeyColumn(event.target.value);
              setKey.reset();
            }}
          />
          {current.keyColumn !== null && !changed && <p className={styles.note}>{t('datasets.load.keySaved', { column: current.keyColumn })}</p>}
          <DatasetError error={setKey.error} context="upload" />
        </div>
      </Dialog>
    );
  }

  const nameError = submitted && creating && name.trim() === '' ? t('datasets.load.nameRequired') : undefined;
  const fileError = refusal === 'notXlsx' ? t('datasets.load.notXlsx') : refusal === 'tooBig' ? t('datasets.load.tooBig', { size: formatFileSize(MAX_FILE_BYTES) }) : submitted && file === undefined ? t('datasets.load.fileRequired') : undefined;
  return (
    <Dialog
      open
      title={creating ? t('datasets.load.createTitle') : t('datasets.load.reloadTitle')}
      closeLabel={t('close')}
      onClose={close}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (file === undefined || (creating && name.trim() === '') || load.isPending) return;
        load.mutate(file);
      }}
      footer={
        <>
          <Button onClick={close}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={load.isPending}>
            {load.isPending ? t('datasets.load.loading') : t('datasets.load.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.fields}>
        {!creating && <p className={styles.note}>{t('datasets.load.reloadBody', { name: dataset.name })}</p>}
        <div className={styles.file}>
          <label htmlFor={inputId} className="text-label">
            {t('datasets.load.file')}
            <span aria-hidden="true"> *</span>
          </label>
          <input id={inputId} type="file" accept={XLSX} required aria-describedby={`${inputId}-hint`} aria-invalid={fileError !== undefined} disabled={load.isPending} onChange={choose} />
          <span id={`${inputId}-hint`} className={styles.note}>
            {t('datasets.load.fileHint', { size: formatFileSize(MAX_FILE_BYTES), columns: DATASET_MAX_COLUMNS, rows: DATASET_MAX_ROWS.toLocaleString('es-CO') })}
          </span>
          {fileError !== undefined && <span className={styles.error}>{fileError}</span>}
        </div>
        {creating && (
          <>
            <TextField
              label={t('datasets.load.name')}
              required
              maxLength={NAME_MAX}
              error={nameError}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameTouched(true);
              }}
            />
            <Select
              label={t('datasets.load.scope')}
              hint={t('datasets.load.scopeHint')}
              options={[{ value: ALL_WORKFLOWS, label: t('datasets.allWorkflows') }, ...(workflows.data ?? []).map((workflow) => ({ value: workflow.id, label: workflow.name }))]}
              value={workflowId}
              onChange={(event) => setWorkflowId(event.target.value)}
            />
          </>
        )}
        <DatasetError error={load.error} context="upload" />
      </div>
    </Dialog>
  );
}
