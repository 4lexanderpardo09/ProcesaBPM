import type { FieldDocument } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Checkbox, Dialog, Select } from '@/shared/ui';
import { WorkflowError } from '../../../components/WorkflowError';
import { datasetsQueryOptions } from '../../api/builder-api';
import type { DraftContent } from '../../hooks/use-draft-content';
import { upsertField } from '../../lib/content-doc';
import { datasetMatches, isFilledFrom } from '../../lib/dataset-fill';
import styles from '../Builder.module.css';

export interface FillFromDatasetDialogProps {
  /** The fields of the block: the key and the fields it fills are all in the same form. */
  readonly fields: readonly FieldDocument[];
  readonly content: DraftContent;
  readonly onClose: () => void;
}

/**
 * Sets up, in one go, every text field of the block named like a column of an Excel to fill itself when the key is
 * typed in another field (the help desk's "campo trigger"). Each field gets an ordinary lookup, which can still be
 * changed one by one afterwards.
 */
export function FillFromDatasetDialog({ fields, content, onClose }: FillFromDatasetDialogProps) {
  const { t } = useTranslation('workflows');
  const { workflowId = '' } = useParams();
  const datasets = useQuery(datasetsQueryOptions(useApiClient(), workflowId));
  const withKey = (datasets.data ?? []).filter((dataset) => dataset.isActive && dataset.keyColumn !== null);
  const [datasetId, setDatasetId] = useState('');
  const [keyCode, setKeyCode] = useState('');
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  const dataset = withKey.find((candidate) => candidate.id === datasetId);
  const matches = dataset === undefined || keyCode === '' ? undefined : datasetMatches(fields, dataset, keyCode);
  const chosen = (matches?.fillable ?? []).filter((match) => !skipped.has(match.field.id) && !isFilledFrom(match.field, datasetId, match.column, keyCode));

  const apply = async () => {
    for (const { field, column } of chosen) {
      const dataSource = { kind: 'DATASET', datasetId, column, lookupFieldCode: keyCode };
      if (!(await content.run({ call: (api) => api.updateField(field.id, { dataSource }), apply: upsertField }))) return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      title={t('builder.fields.fill.title')}
      closeLabel={t('close')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="brand" disabled={chosen.length === 0 || content.pending} onClick={() => void apply()}>
            {t('builder.fields.fill.apply', { count: chosen.length })}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        <p className={styles.note}>{t('builder.fields.fill.hint')}</p>
        {datasets.data !== undefined && withKey.length === 0 ? (
          <Alert tone="warn">{t('builder.fields.fill.noDatasets')}</Alert>
        ) : (
          <>
            <Select
              label={t('builder.fields.fill.dataset')}
              placeholder={t('builder.fields.config.datasetPlaceholder')}
              options={withKey.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
              value={datasetId}
              onChange={(event) => setDatasetId(event.target.value)}
            />
            {dataset !== undefined && (
              <Select
                label={t('builder.fields.fill.key', { column: dataset.keyColumn ?? '' })}
                hint={t('builder.fields.fill.keyHint')}
                placeholder={t('builder.fields.fill.keyPlaceholder')}
                options={fields.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
                value={keyCode}
                onChange={(event) => setKeyCode(event.target.value)}
              />
            )}
          </>
        )}
        {matches !== undefined && (
          <>
            {matches.fillable.length === 0 ? (
              <p className={styles.note}>{t('builder.fields.fill.none')}</p>
            ) : (
              <fieldset className={styles.dialogBody} aria-label={t('builder.fields.fill.matches')}>
                {matches.fillable.map(({ field, column }) => {
                  const done = isFilledFrom(field, datasetId, column, keyCode);
                  return (
                    <Checkbox
                      key={field.id}
                      label={done ? t('builder.fields.fill.matchDone', { field: field.label, code: field.code, column }) : t('builder.fields.fill.match', { field: field.label, code: field.code, column })}
                      disabled={done}
                      checked={done || !skipped.has(field.id)}
                      onChange={(event) =>
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.delete(field.id);
                          else next.add(field.id);
                          return next;
                        })
                      }
                    />
                  );
                })}
              </fieldset>
            )}
            {matches.unsupported.length > 0 && (
              <p className={styles.note}>{t('builder.fields.fill.unsupported', { fields: matches.unsupported.map(({ field }) => field.code).join(', ') })}</p>
            )}
          </>
        )}
        <WorkflowError error={content.error} context="field" />
      </div>
    </Dialog>
  );
}
