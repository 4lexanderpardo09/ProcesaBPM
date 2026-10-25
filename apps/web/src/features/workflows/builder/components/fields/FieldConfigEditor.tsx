import { effectiveFieldType, type FieldDocument, type FieldType, listCalculators } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { positionsQueryOptions } from '@/features/people';
import { paths } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Checkbox, Select, TextArea, TextField } from '@/shared/ui';
import { datasetsQueryOptions } from '../../api/builder-api';
import { patchConfig } from '../../lib/numbers';
import { DecimalField } from '../DecimalField';
import { WholeNumberField } from '../WholeNumberField';
import { type FieldOption, OptionsEditor } from './OptionsEditor';
import { type TableColumn, TableColumnsEditor } from './TableColumnsEditor';
import styles from '../Builder.module.css';

export type FieldConfig = Record<string, unknown>;
export type FieldDataSource = Record<string, unknown> | null;

export interface FieldConfigEditorProps {
  readonly type: FieldType;
  readonly config: FieldConfig;
  readonly dataSource: FieldDataSource;
  /** The other fields of the version (lookups, calculator inputs). */
  readonly fields: readonly FieldDocument[];
  readonly onChange: (config: FieldConfig, dataSource: FieldDataSource) => void;
}

const CURRENCIES = ['COP', 'USD', 'EUR'];
const PRESETS = ['COMPANIES', 'DEPARTMENTS', 'POSITIONS', 'SITES', 'USERS'] as const;
const FILE_KINDS = ['PDF', 'IMAGE', 'OFFICE', 'ZIP'] as const;
const RESULT_TYPES = ['NUMBER', 'CURRENCY', 'DATE', 'TEXT'] as const;
const INPUT_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  DATETIME: new Set(['DATETIME']),
  DATE: new Set(['DATE']),
  NUMBER: new Set(['NUMBER', 'CURRENCY', 'DAYS']),
  TEXT: new Set(['TEXT', 'TEXTAREA', 'SELECT']),
};

const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/** What each type of field lets configure; every value goes through the same schema the API checks. */
export function FieldConfigEditor({ type, config, dataSource, fields, onChange }: FieldConfigEditorProps) {
  const { t } = useTranslation('workflows');
  const set = (patch: Record<string, unknown>) => onChange(patchConfig(config, patch), dataSource);
  const label = (key: string) => t(`builder.fields.config.${key}` as 'builder.fields.config.min');

  switch (type) {
    case 'TEXT':
      return (
        <>
          <WholeNumberField label={label('maxLength')} min={1} max={1000} value={num(config.maxLength)} onChange={(value) => set({ maxLength: value ?? undefined })} />
          <TextField label={label('placeholder')} maxLength={200} value={str(config.placeholder)} onChange={(event) => set({ placeholder: event.target.value === '' ? undefined : event.target.value })} />
          <fieldset className={styles.choices}>
            <legend>{label('textFromDataset')}</legend>
            <DatasetSource dataSource={dataSource} fields={fields} optional onChange={(next) => onChange(config, next)} />
          </fieldset>
        </>
      );
    case 'TEXTAREA':
      return <WholeNumberField label={label('maxLength')} min={1} max={10_000} value={num(config.maxLength)} onChange={(value) => set({ maxLength: value ?? undefined })} />;
    case 'NUMBER':
      return (
        <>
          <div className={styles.pair}>
            <DecimalField label={label('min')} value={num(config.min)} onChange={(value) => set({ min: value ?? undefined })} />
            <DecimalField label={label('max')} value={num(config.max)} onChange={(value) => set({ max: value ?? undefined })} />
          </div>
          <WholeNumberField label={label('decimals')} min={0} max={6} value={num(config.decimals) ?? 0} onChange={(value) => set({ decimals: value ?? 0 })} />
        </>
      );
    case 'CURRENCY':
      return (
        <>
          <Select label={label('currency')} options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={str(config.currencyCode) || 'COP'} onChange={(event) => set({ currencyCode: event.target.value })} />
          <div className={styles.pair}>
            <DecimalField label={label('min')} value={num(config.min)} onChange={(value) => set({ min: value ?? undefined })} />
            <DecimalField label={label('max')} value={num(config.max)} onChange={(value) => set({ max: value ?? undefined })} />
          </div>
        </>
      );
    case 'SELECT':
    case 'MULTI_SELECT':
      return (
        <>
          <ListSource config={config} dataSource={dataSource} fields={fields} onChange={onChange} />
          {type === 'MULTI_SELECT' && (
            <div className={styles.pair}>
              <WholeNumberField label={label('minSelected')} min={0} value={num(config.minSelected)} onChange={(value) => set({ minSelected: value ?? undefined })} />
              <WholeNumberField label={label('maxSelected')} min={1} value={num(config.maxSelected)} onChange={(value) => set({ maxSelected: value ?? undefined })} />
            </div>
          )}
        </>
      );
    case 'DATE':
    case 'DATETIME':
      return (
        <>
          <DateBound label={label('dateMin')} value={config.min} onChange={(value) => set({ min: value })} />
          <DateBound label={label('dateMax')} value={config.max} onChange={(value) => set({ max: value })} />
          <p className={styles.note}>{label('dateHint')}</p>
          <Checkbox label={label(type === 'DATE' ? 'defaultToday' : 'defaultNow')} checked={config.defaultNow === true} onChange={(event) => set({ defaultNow: event.target.checked ? true : undefined })} />
          <p className={styles.note}>{label('defaultNowHint')}</p>
        </>
      );
    case 'DAYS':
      return (
        <div className={styles.pair}>
          <WholeNumberField label={label('min')} value={num(config.min)} onChange={(value) => set({ min: value ?? undefined })} />
          <WholeNumberField label={label('max')} value={num(config.max)} onChange={(value) => set({ max: value ?? undefined })} />
        </div>
      );
    case 'SITE':
      return <WholeNumberField label={label('siteLevel')} hint={label('siteLevelHint')} min={1} max={20} value={num(config.level)} onChange={(value) => set({ level: value ?? undefined })} />;
    case 'USER':
      return <PositionsFilter selected={(config.positionIds as string[] | undefined) ?? []} onChange={(ids) => set({ positionIds: ids.length === 0 ? undefined : ids })} />;
    case 'TABLE':
      return (
        <>
          <TableColumnsEditor columns={(config.columns as TableColumn[] | undefined) ?? []} onChange={(columns) => set({ columns })} />
          <div className={styles.pair}>
            <WholeNumberField label={label('minRows')} min={0} value={num(config.minRows) ?? 0} onChange={(value) => set({ minRows: value ?? 0 })} />
            <WholeNumberField label={label('maxRows')} min={1} max={200} value={num(config.maxRows) ?? 200} onChange={(value) => set({ maxRows: value ?? 200 })} />
          </div>
        </>
      );
    case 'FILE': {
      const accept = (config.accept as string[] | undefined) ?? [...FILE_KINDS];
      return (
        <>
          <WholeNumberField label={label('maxFiles')} min={1} max={15} value={num(config.maxFiles) ?? 1} onChange={(value) => set({ maxFiles: value ?? 1 })} />
          <fieldset className={styles.choices}>
            <legend>{label('accept')}</legend>
            {FILE_KINDS.map((kind) => (
              <Checkbox
                key={kind}
                label={t(`builder.fields.config.acceptKinds.${kind}`)}
                checked={accept.includes(kind)}
                onChange={(event) => set({ accept: event.target.checked ? [...accept.filter((value) => value !== kind), kind] : accept.filter((value) => value !== kind) })}
              />
            ))}
          </fieldset>
        </>
      );
    }
    case 'FORMULA':
      return (
        <>
          <TextArea
            label={label('expression')}
            hint={t('builder.fields.config.expressionHint', { example: 'MONTO * 0.19, SUM(ITEMS.VALOR), DAYS_BETWEEN(FECHA_INICIO, FECHA_FIN)' })}
            maxLength={2000}
            rows={3}
            value={str(config.expression)}
            onChange={(event) => set({ expression: event.target.value })}
          />
          <Select
            label={label('resultType')}
            options={RESULT_TYPES.map((value) => ({ value, label: t(`builder.fields.config.resultTypes.${value}`) }))}
            value={str(config.resultType) || 'NUMBER'}
            onChange={(event) => set({ resultType: event.target.value, decimals: event.target.value === 'NUMBER' ? config.decimals : undefined })}
          />
          {(str(config.resultType) || 'NUMBER') === 'NUMBER' && <WholeNumberField label={label('decimals')} min={0} max={6} value={num(config.decimals)} onChange={(value) => set({ decimals: value ?? undefined })} />}
        </>
      );
    case 'CALCULATOR': {
      const calculator = listCalculators().find((candidate) => candidate.code === config.calculatorCode);
      const inputs = (config.inputs ?? {}) as Record<string, string>;
      return (
        <>
          <Select
            label={t('builder.calculator.calculator')}
            placeholder={t('builder.calculator.placeholder')}
            options={listCalculators().map((candidate) => ({ value: candidate.code, label: t(`builder.calculator.names.${candidate.code as 'MEAL_ALLOWANCE'}`, { defaultValue: candidate.code }) }))}
            value={str(config.calculatorCode)}
            onChange={(event) => onChange({ calculatorCode: event.target.value, inputs: {} }, null)}
          />
          {calculator?.parameters.map((parameter) => (
            <Select
              key={parameter.name}
              label={t('builder.calculator.input', { name: t(`builder.calculator.parameters.${parameter.name as 'advance'}`, { defaultValue: parameter.name }) })}
              placeholder={t('builder.calculator.inputPlaceholder')}
              options={fields.filter((field) => INPUT_TYPES[parameter.type]?.has(effectiveFieldType(field)) === true).map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
              value={inputs[parameter.name] ?? ''}
              onChange={(event) => set({ inputs: patchConfig(inputs, { [parameter.name]: event.target.value === '' ? undefined : event.target.value }) })}
            />
          ))}
        </>
      );
    }
  }
}

function DateBound({ label, value, onChange }: { readonly label: string; readonly value: unknown; readonly onChange: (value: string | undefined) => void }) {
  const { t } = useTranslation('workflows');
  const mode = value === 'TODAY' ? 'TODAY' : typeof value === 'string' ? 'DATE' : 'NONE';
  return (
    <div className={styles.pair}>
      <Select
        label={label}
        options={[
          { value: 'NONE', label: t('builder.fields.config.anyDate') },
          { value: 'TODAY', label: t('builder.fields.config.today') },
          { value: 'DATE', label: t('builder.fields.config.aDate') },
        ]}
        value={mode}
        onChange={(event) => onChange(event.target.value === 'NONE' ? undefined : event.target.value === 'TODAY' ? 'TODAY' : new Date().toISOString().slice(0, 10))}
      />
      {mode === 'DATE' && <TextField label={t('builder.fields.config.aDate')} type="date" value={String(value)} onChange={(event) => event.target.value !== '' && onChange(event.target.value)} />}
    </div>
  );
}

function PositionsFilter({ selected, onChange }: { readonly selected: readonly string[]; readonly onChange: (ids: string[]) => void }) {
  const { t } = useTranslation('workflows');
  const positions = useQuery(positionsQueryOptions(useApiClient())).data ?? [];
  return (
    <fieldset className={styles.choices}>
      <legend>{t('builder.fields.config.positions')}</legend>
      <p className={styles.note}>{t('builder.fields.config.positionsHint')}</p>
      {positions
        .filter((position) => position.isActive || selected.includes(position.id))
        .map((position) => (
          <Checkbox
            key={position.id}
            label={position.name}
            checked={selected.includes(position.id)}
            onChange={(event) => onChange(event.target.checked ? [...selected, position.id] : selected.filter((id) => id !== position.id))}
          />
        ))}
    </fieldset>
  );
}

type SourceKind = 'OPTIONS' | 'PRESET' | 'DATASET';

/** Where a list takes its options: its own, one of the organization, or a column of an uploaded Excel. */
function ListSource({ config, dataSource, fields, onChange }: { readonly config: FieldConfig; readonly dataSource: FieldDataSource; readonly fields: readonly FieldDocument[]; readonly onChange: (config: FieldConfig, dataSource: FieldDataSource) => void }) {
  const { t } = useTranslation('workflows');
  const kind: SourceKind = dataSource === null ? 'OPTIONS' : dataSource.kind === 'PRESET' ? 'PRESET' : 'DATASET';
  const options = (config.options as FieldOption[] | undefined) ?? [];
  return (
    <>
      <Select
        label={t('builder.fields.config.source')}
        options={(['OPTIONS', 'PRESET', 'DATASET'] as const).map((value) => ({ value, label: t(`builder.fields.config.sources.${value}`) }))}
        value={kind}
        onChange={(event) => {
          const next = event.target.value as SourceKind;
          const withoutOptions = patchConfig(config, { options: undefined });
          if (next === 'OPTIONS') onChange(patchConfig(config, { options: options.length > 0 ? options : [{ value: '', label: '' }] }), null);
          else if (next === 'PRESET') onChange(withoutOptions, { kind: 'PRESET', preset: 'COMPANIES' });
          else onChange(withoutOptions, { kind: 'DATASET', datasetId: '', column: '' });
        }}
      />
      {kind === 'OPTIONS' && <OptionsEditor options={options} onChange={(next) => onChange(patchConfig(config, { options: next }), null)} />}
      {kind === 'PRESET' && (
        <Select
          label={t('builder.fields.config.preset')}
          options={PRESETS.map((value) => ({ value, label: t(`builder.fields.config.presets.${value}`) }))}
          value={str(dataSource?.preset) || 'COMPANIES'}
          onChange={(event) => onChange(config, { kind: 'PRESET', preset: event.target.value })}
        />
      )}
      {kind === 'DATASET' && <DatasetSource dataSource={dataSource} fields={fields} onChange={(next) => onChange(config, next)} />}
    </>
  );
}

/** A column of an uploaded Excel; optionally found by the key typed in another field. */
function DatasetSource({ dataSource, fields, optional = false, onChange }: { readonly dataSource: FieldDataSource; readonly fields: readonly FieldDocument[]; readonly optional?: boolean; readonly onChange: (dataSource: FieldDataSource) => void }) {
  const { t } = useTranslation('workflows');
  const { workflowId = '' } = useParams();
  const datasets = useQuery(datasetsQueryOptions(useApiClient(), workflowId));
  const current = dataSource?.kind === 'DATASET' ? dataSource : null;
  const dataset = datasets.data?.find((candidate) => candidate.id === current?.datasetId);
  const update = (patch: Record<string, unknown>) => onChange(patchConfig({ kind: 'DATASET', datasetId: '', column: '', ...(current ?? {}) }, patch));
  if (datasets.data !== undefined && datasets.data.length === 0) {
    if (optional) return null;
    return (
      <p className={styles.note}>
        {t('builder.fields.config.noDatasets')}{' '}
        <Link to={paths.datasets} target="_blank" rel="noopener">
          {t('builder.fields.config.loadDataset')}
        </Link>
      </p>
    );
  }
  return (
    <>
      <Select
        label={t('builder.fields.config.dataset')}
        placeholder={optional ? t('builder.fields.config.none') : t('builder.fields.config.datasetPlaceholder')}
        options={(datasets.data ?? []).filter((candidate) => candidate.isActive || candidate.id === current?.datasetId).map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        value={str(current?.datasetId)}
        onChange={(event) => (event.target.value === '' ? onChange(null) : update({ datasetId: event.target.value, column: '', lookupFieldCode: undefined }))}
      />
      {current !== null && dataset !== undefined && (
        <>
          <Select
            label={t('builder.fields.config.column')}
            placeholder={t('builder.fields.config.columnPlaceholder')}
            options={dataset.columns.map((column) => ({ value: column.name, label: column.name }))}
            value={str(current.column)}
            onChange={(event) => update({ column: event.target.value })}
          />
          {dataset.keyColumn !== null && (
            <Select
              label={t('builder.fields.config.lookup')}
              hint={t('builder.fields.config.lookupHint')}
              placeholder={t('builder.fields.config.none')}
              options={fields.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
              value={str(current.lookupFieldCode)}
              onChange={(event) => update({ lookupFieldCode: event.target.value === '' ? undefined : event.target.value })}
            />
          )}
        </>
      )}
    </>
  );
}
