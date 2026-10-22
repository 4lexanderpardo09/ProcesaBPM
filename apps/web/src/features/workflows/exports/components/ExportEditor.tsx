import {
  EXPORT_COLUMN_SOURCES,
  EXPORT_DELIMITERS,
  EXPORT_FILTER_OPERATORS,
  EXPORT_FREQUENCIES,
  EXPORT_REQUESTER_ATTRIBUTES,
  EXPORT_VALUE_FORMATS,
  type ExportColumn,
  type ExportDefinitionResponse,
  type ExportFilterRule,
  type SaveExportDefinitionRequest,
  saveExportDefinitionRequestSchema,
} from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, Checkbox, PlusIcon, Select, TextField } from '@/shared/ui';
import { allWorkflowsQueryOptions, workflowQueryOptions } from '../../api/workflows-api';
import { versionDetailQueryOptions } from '../../builder/api/builder-api';
import { WorkflowError } from '../../components/WorkflowError';
import { companiesQueryOptions, exportQueryKeys, saveExport } from '../api/exports-api';
import styles from './Exports.module.css';

type Draft = SaveExportDefinitionRequest;
type Source = ExportColumn['sourceType'];

/** Sources that need a reference, and those that do not (the company, the row number, the dates). */
const NEEDS_REF: ReadonlySet<Source> = new Set(['FIELD', 'DERIVED', 'CONSTANT', 'REQUESTER', 'TABLE_SUM', 'CATALOG', 'FORMULA']);
const FIELD_SOURCES: ReadonlySet<Source> = new Set(['FIELD', 'DERIVED']);
const TEXT_REF: ReadonlySet<Source> = new Set(['CONSTANT', 'TABLE_SUM', 'CATALOG', 'FORMULA']);

const draftOf = (definition: ExportDefinitionResponse | undefined): Draft =>
  definition === undefined
    ? {
        workflowId: '',
        companyId: null,
        name: '',
        format: 'CSV',
        sheetName: 'Export',
        delimiter: ';',
        trigger: 'TRANSITION',
        transitionLabel: null,
        filter: [],
        mergeBy: null,
        separateBy: null,
        schedule: { cutoffTime: '17:00', frequency: 'DAILY', weekdays: [], monthDay: null, intervalDays: null },
        isActive: true,
        columns: [{ header: '', sourceType: 'FIELD', sourceRef: null, format: null }],
      }
    : {
        workflowId: definition.workflowId,
        companyId: definition.companyId,
        name: definition.name,
        format: definition.format,
        sheetName: definition.sheetName,
        delimiter: definition.delimiter as Draft['delimiter'],
        trigger: definition.trigger,
        transitionLabel: definition.transitionLabel,
        filter: definition.filter,
        mergeBy: definition.mergeBy,
        separateBy: definition.separateBy,
        schedule: definition.schedule,
        isActive: definition.isActive,
        columns: definition.columns,
      };

/** What the editor reads of the workflow: its fields, the labels of its decisions and its people steps (published version first). */
function useWorkflowShape(workflowId: string) {
  const client = useApiClient();
  const workflow = useQuery({ ...workflowQueryOptions(client, workflowId), enabled: workflowId !== '' });
  const version = workflow.data?.versions.find((candidate) => candidate.status === 'PUBLISHED') ?? workflow.data?.versions.find((candidate) => candidate.status === 'DRAFT');
  const detail = useQuery({ ...versionDetailQueryOptions(client, workflowId, version?.id ?? ''), enabled: version !== undefined });
  const document = detail.data?.document;
  return {
    fields: document?.fields ?? [],
    labels: [...new Set((document?.transitions ?? []).filter((transition) => transition.type === 'DECISION').map((transition) => transition.label))].sort(),
    steps: (document?.steps ?? []).filter((step) => ['TASK', 'APPROVAL', 'DECISION', 'SIGNATURE'].includes(step.type)),
  };
}

export interface ExportEditorProps {
  /** `undefined` for a new export. */
  readonly definition: ExportDefinitionResponse | undefined;
  readonly readOnly: boolean;
  readonly onSaved: (saved: ExportDefinitionResponse) => void;
}

/**
 * The whole definition of an export: which workflow and moment write the line, the filter, the columns of the file
 * and where each takes its value, how files merge rows or split, and when the automatic cutoff runs.
 */
export function ExportEditor({ definition, readOnly, onSaved }: ExportEditorProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => draftOf(definition));
  const [submitted, setSubmitted] = useState(false);
  const [saved, setSaved] = useState(false);
  const workflows = useQuery(allWorkflowsQueryOptions(client));
  const companies = useQuery(companiesQueryOptions(client));
  const shape = useWorkflowShape(draft.workflowId);
  const save = useMutation({
    mutationFn: (body: Draft) => saveExport(client, definition?.id, body),
    onSuccess: async (result) => {
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: exportQueryKeys.all });
      onSaved(result);
    },
  });
  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const setColumn = (index: number, patch: Partial<ExportColumn>) => change({ columns: draft.columns.map((column, at) => (at === index ? { ...column, ...patch } : column)) });
  const moveColumn = (index: number, by: -1 | 1) => {
    const columns = [...draft.columns];
    const [moved] = columns.splice(index, 1);
    columns.splice(index + by, 0, moved!);
    change({ columns });
  };
  const setRule = (index: number, patch: Partial<ExportFilterRule>) => change({ filter: draft.filter.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)) });

  const problems = problemsOf(draft);
  const headers = draft.columns.map((column) => column.header.trim()).filter((header) => header !== '');
  const fieldOptions = shape.fields.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }));

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        const parsed = saveExportDefinitionRequestSchema.safeParse(draft);
        if (problems.length === 0 && parsed.success) save.mutate(parsed.data);
      }}
    >
      <fieldset disabled={readOnly} className={styles.form} style={{ border: 0, margin: 0, padding: 0 }}>
        <Card title={t('exports.editor.general')}>
          <div className={styles.grid}>
            <TextField label={t('exports.editor.name')} required value={draft.name} maxLength={150} onChange={(event) => change({ name: event.target.value })} />
            <Select
              label={t('exports.editor.workflow')}
              required
              placeholder={t('exports.editor.chooseWorkflow')}
              options={(workflows.data ?? []).map((workflow) => ({ value: workflow.id, label: workflow.name }))}
              value={draft.workflowId}
              onChange={(event) => change({ workflowId: event.target.value, transitionLabel: null, separateBy: null })}
            />
            <Select
              label={t('exports.editor.company')}
              placeholder={t('exports.editor.anyCompany')}
              options={(companies.data ?? []).filter((company) => company.isActive || company.id === draft.companyId).map((company) => ({ value: company.id, label: company.name }))}
              value={draft.companyId ?? ''}
              onChange={(event) => change({ companyId: event.target.value === '' ? null : event.target.value })}
            />
            <Select label={t('exports.editor.format')} options={(['CSV', 'XLSX'] as const).map((value) => ({ value, label: t(`exports.editor.formats.${value}`) }))} value={draft.format} onChange={(event) => change({ format: event.target.value as Draft['format'] })} />
            {draft.format === 'CSV' ? (
              <Select
                label={t('exports.editor.delimiter')}
                options={EXPORT_DELIMITERS.map((value) => ({ value, label: t(`exports.editor.delimiters.${DELIMITER_NAMES[value]}`) }))}
                value={draft.delimiter}
                onChange={(event) => change({ delimiter: event.target.value as Draft['delimiter'] })}
              />
            ) : (
              <TextField label={t('exports.editor.sheetName')} value={draft.sheetName} maxLength={31} onChange={(event) => change({ sheetName: event.target.value })} />
            )}
          </div>
          <Checkbox label={t('exports.editor.active')} checked={draft.isActive} onChange={(event) => change({ isActive: event.target.checked })} />
        </Card>

        <Card title={t('exports.editor.whenTitle')}>
          <div className={styles.grid}>
            <Select
              label={t('exports.editor.trigger')}
              options={(['TRANSITION', 'CLOSING'] as const).map((value) => ({ value, label: t(`exports.editor.triggers.${value}`) }))}
              value={draft.trigger}
              onChange={(event) => change({ trigger: event.target.value as Draft['trigger'], transitionLabel: null })}
            />
            {draft.trigger === 'TRANSITION' && (
              <Select
                label={t('exports.editor.transitionLabel')}
                hint={t('exports.editor.transitionLabelHint')}
                required
                placeholder={t('exports.editor.chooseTransition')}
                options={[...new Set([...shape.labels, ...(draft.transitionLabel === null ? [] : [draft.transitionLabel])])].map((label) => ({ value: label, label }))}
                value={draft.transitionLabel ?? ''}
                onChange={(event) => change({ transitionLabel: event.target.value === '' ? null : event.target.value })}
              />
            )}
          </div>
        </Card>

        <Card
          title={t('exports.editor.filterTitle')}
          actions={
            <Button icon={<PlusIcon size={15} />} onClick={() => change({ filter: [...draft.filter, { fieldCode: shape.fields[0]?.code ?? '', operator: 'EQUALS', value: '' }] })}>
              {t('exports.editor.addRule')}
            </Button>
          }
        >
          <p className={styles.note}>{t('exports.editor.filterHint')}</p>
          {draft.filter.map((rule, index) => (
            <fieldset key={index} className={`${styles.item} ${styles.rule}`}>
              <Select label={t('exports.editor.field')} options={fieldOptions} value={rule.fieldCode} onChange={(event) => setRule(index, { fieldCode: event.target.value })} />
              <Select label={t('exports.editor.operator')} options={EXPORT_FILTER_OPERATORS.map((value) => ({ value, label: t(`exports.editor.operators.${value}`) }))} value={rule.operator} onChange={(event) => setRule(index, { operator: event.target.value as ExportFilterRule['operator'] })} />
              <TextField label={t('exports.editor.value')} hint={rule.operator === 'IN_LIST' ? t('exports.editor.valueListHint') : undefined} value={rule.value} maxLength={500} onChange={(event) => setRule(index, { value: event.target.value })} />
              <Button variant="ghost" aria-label={t('exports.editor.removeRule', { number: index + 1 })} onClick={() => change({ filter: draft.filter.filter((_, at) => at !== index) })}>
                {t('remove')}
              </Button>
            </fieldset>
          ))}
        </Card>

        <Card
          title={t('exports.editor.columnsTitle')}
          actions={
            <Button icon={<PlusIcon size={15} />} onClick={() => change({ columns: [...draft.columns, { header: '', sourceType: 'FIELD', sourceRef: null, format: null }] })}>
              {t('exports.editor.addColumn')}
            </Button>
          }
        >
          <p className={styles.note}>{t('exports.editor.columnsHint')}</p>
          {draft.columns.map((column, index) => (
            <fieldset key={index} className={styles.item} aria-label={t('exports.editor.column', { number: index + 1 })}>
              <TextField label={t('exports.editor.header')} value={column.header} maxLength={100} onChange={(event) => setColumn(index, { header: event.target.value })} />
              <Select
                label={t('exports.editor.source')}
                options={EXPORT_COLUMN_SOURCES.map((value) => ({ value, label: t(`exports.editor.sources.${value}`) }))}
                value={column.sourceType}
                onChange={(event) => setColumn(index, { sourceType: event.target.value as Source, sourceRef: null })}
              />
              <ColumnReference column={column} fieldOptions={fieldOptions} onChange={(sourceRef) => setColumn(index, { sourceRef })} />
              <Select
                label={t('exports.editor.valueFormat')}
                placeholder={t('exports.editor.noFormat')}
                options={EXPORT_VALUE_FORMATS.map((value) => ({ value, label: t(`exports.editor.formatsList.${value}`) }))}
                value={column.format ?? ''}
                onChange={(event) => setColumn(index, { format: event.target.value === '' ? null : (event.target.value as ExportColumn['format']) })}
              />
              <span className={styles.itemActions}>
                <Button variant="ghost" aria-label={t('exports.editor.moveUp', { number: index + 1 })} disabled={index === 0} onClick={() => moveColumn(index, -1)}>
                  ↑
                </Button>
                <Button variant="ghost" aria-label={t('exports.editor.moveDown', { number: index + 1 })} disabled={index === draft.columns.length - 1} onClick={() => moveColumn(index, 1)}>
                  ↓
                </Button>
                <Button variant="ghost" aria-label={t('exports.editor.removeColumn', { number: index + 1 })} disabled={draft.columns.length === 1} onClick={() => change({ columns: draft.columns.filter((_, at) => at !== index) })}>
                  {t('remove')}
                </Button>
              </span>
            </fieldset>
          ))}
        </Card>

        <Card title={t('exports.editor.filesTitle')}>
          <div className={styles.grid}>
            <Select
              label={t('exports.editor.mergeBy')}
              hint={t('exports.editor.mergeHint')}
              placeholder={t('exports.editor.noMerge')}
              options={headers.map((header) => ({ value: header, label: header }))}
              value={draft.mergeBy ?? ''}
              onChange={(event) => change({ mergeBy: event.target.value === '' ? null : event.target.value })}
            />
            <Select
              label={t('exports.editor.separateBy')}
              options={(['NONE', 'RESPONSIBLE', 'COLUMN'] as const).map((value) => ({ value, label: t(`exports.editor.separations.${value}`) }))}
              value={draft.separateBy?.kind ?? 'NONE'}
              onChange={(event) => {
                const kind = event.target.value;
                change({ separateBy: kind === 'RESPONSIBLE' ? { kind, stepId: '' } : kind === 'COLUMN' ? { kind, header: '' } : null });
              }}
            />
            {draft.separateBy?.kind === 'RESPONSIBLE' && (
              <Select
                label={t('exports.editor.separationStep')}
                placeholder={t('exports.editor.chooseStep')}
                options={shape.steps.map((step) => ({ value: step.id, label: step.name }))}
                value={draft.separateBy.stepId}
                onChange={(event) => change({ separateBy: { kind: 'RESPONSIBLE', stepId: event.target.value } })}
              />
            )}
            {draft.separateBy?.kind === 'COLUMN' && (
              <Select
                label={t('exports.editor.separationColumn')}
                placeholder={t('exports.editor.chooseColumn')}
                options={headers.map((header) => ({ value: header, label: header }))}
                value={draft.separateBy.header}
                onChange={(event) => change({ separateBy: { kind: 'COLUMN', header: event.target.value } })}
              />
            )}
          </div>
        </Card>

        <Card title={t('exports.editor.scheduleTitle')}>
          <p className={styles.note}>{t('exports.editor.scheduleHint')}</p>
          <div className={styles.grid}>
            <TextField label={t('exports.editor.cutoffTime')} type="time" value={draft.schedule.cutoffTime} onChange={(event) => change({ schedule: { ...draft.schedule, cutoffTime: event.target.value } })} />
            <Select
              label={t('exports.editor.frequency')}
              options={EXPORT_FREQUENCIES.map((value) => ({ value, label: t(`exports.editor.frequencies.${value}`) }))}
              value={draft.schedule.frequency}
              onChange={(event) => change({ schedule: { ...draft.schedule, frequency: event.target.value as Draft['schedule']['frequency'] } })}
            />
            {draft.schedule.frequency === 'MONTHLY' && (
              <TextField
                label={t('exports.editor.monthDay')}
                inputMode="numeric"
                value={draft.schedule.monthDay === null ? '' : String(draft.schedule.monthDay)}
                onChange={(event) => change({ schedule: { ...draft.schedule, monthDay: wholeOrNull(event.target.value) } })}
              />
            )}
            {draft.schedule.frequency === 'EVERY_N_DAYS' && (
              <TextField
                label={t('exports.editor.intervalDays')}
                inputMode="numeric"
                value={draft.schedule.intervalDays === null ? '' : String(draft.schedule.intervalDays)}
                onChange={(event) => change({ schedule: { ...draft.schedule, intervalDays: wholeOrNull(event.target.value) } })}
              />
            )}
          </div>
          {draft.schedule.frequency === 'WEEKLY' && (
            <fieldset className={styles.days}>
              <legend>{t('exports.editor.weekdays')}</legend>
              {[1, 2, 3, 4, 5, 6, 7].map((day) => (
                <Checkbox
                  key={day}
                  label={t(`exports.schedule.weekdays.${String(day) as '1'}`)}
                  checked={draft.schedule.weekdays.includes(day)}
                  onChange={(event) =>
                    change({ schedule: { ...draft.schedule, weekdays: event.target.checked ? [...draft.schedule.weekdays, day].sort() : draft.schedule.weekdays.filter((candidate) => candidate !== day) } })
                  }
                />
              ))}
            </fieldset>
          )}
        </Card>
      </fieldset>

      {submitted && problems.length > 0 && (
        <Alert tone="danger">
          <ul className={styles.problems}>
            {problems.map((problem) => (
              <li key={problem}>{t(`exports.editor.problems.${problem}`)}</li>
            ))}
          </ul>
        </Alert>
      )}
      <WorkflowError error={save.error} context="content" />
      {saved && <Alert tone="ok">{t('exports.editor.saved')}</Alert>}
      {!readOnly && (
        <div className={styles.buttons}>
          <Button type="submit" variant="brand" disabled={save.isPending}>
            {save.isPending ? t('saving') : definition === undefined ? t('exports.editor.create') : t('exports.editor.save')}
          </Button>
        </div>
      )}
    </form>
  );
}

function ColumnReference({ column, fieldOptions, onChange }: { readonly column: ExportColumn; readonly fieldOptions: ReadonlyArray<{ value: string; label: string }>; readonly onChange: (ref: string | null) => void }) {
  const { t } = useTranslation('workflows');
  const source = column.sourceType;
  if (!NEEDS_REF.has(source)) return <span />;
  const label = t(`exports.editor.ref.${source as 'FIELD'}`);
  if (FIELD_SOURCES.has(source)) return <Select label={label} placeholder={t('exports.editor.chooseColumn')} options={fieldOptions} value={column.sourceRef ?? ''} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)} />;
  if (source === 'REQUESTER') {
    return (
      <Select
        label={label}
        placeholder={t('exports.editor.chooseColumn')}
        options={EXPORT_REQUESTER_ATTRIBUTES.map((value) => ({ value, label: t(`exports.editor.requester.${value}`) }))}
        value={column.sourceRef ?? ''}
        onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
      />
    );
  }
  const hint = source === 'TABLE_SUM' || source === 'CATALOG' || source === 'FORMULA' ? t(`exports.editor.refHints.${source}`) : undefined;
  return TEXT_REF.has(source) ? <TextField label={label} hint={hint} value={column.sourceRef ?? ''} maxLength={2000} onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)} /> : <span />;
}

const DELIMITER_NAMES = { ';': 'semicolon', ',': 'comma', '|': 'pipe', '\t': 'tab' } as const;
const wholeOrNull = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null);

type Problem = 'name' | 'workflow' | 'transition' | 'columns' | 'header' | 'ref' | 'separation' | 'schedule';

/** What keeps the definition from being saved, in the order the screen shows it. */
function problemsOf(draft: Draft): Problem[] {
  const problems: Problem[] = [];
  if (draft.name.trim() === '') problems.push('name');
  if (draft.workflowId === '') problems.push('workflow');
  if (draft.trigger === 'TRANSITION' && draft.transitionLabel === null) problems.push('transition');
  if (draft.columns.length === 0) problems.push('columns');
  const headers = draft.columns.map((column) => column.header.trim().toLowerCase());
  if (headers.some((header) => header === '') || new Set(headers).size !== headers.length) problems.push('header');
  if (draft.columns.some((column) => NEEDS_REF.has(column.sourceType) && column.sourceType !== 'CONSTANT' && (column.sourceRef ?? '').trim() === '')) problems.push('ref');
  if ((draft.separateBy?.kind === 'RESPONSIBLE' && draft.separateBy.stepId === '') || (draft.separateBy?.kind === 'COLUMN' && draft.separateBy.header === '')) problems.push('separation');
  const { schedule } = draft;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.cutoffTime) || (schedule.frequency === 'WEEKLY' && schedule.weekdays.length === 0) || (schedule.frequency === 'MONTHLY' && (schedule.monthDay === null || schedule.monthDay < 1 || schedule.monthDay > 31)) || (schedule.frequency === 'EVERY_N_DAYS' && (schedule.intervalDays === null || schedule.intervalDays < 1))) {
    problems.push('schedule');
  }
  return problems;
}
