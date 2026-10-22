import {
  type AssignmentMode,
  ASSIGNMENT_MODES,
  CLOSE_RULES,
  PEOPLE_STEP_TYPES,
  effectiveFieldType,
  type FieldDocument,
  listCalculators,
  SITE_SCOPES,
  SLA_UNITS,
  type StepDocument,
} from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { approvalTypesQueryOptions, positionsQueryOptions } from '@/features/people';
import { ApiError } from '@/shared/api';
import { useApiClient, usePermissions } from '@/shared/session';
import { Checkbox, Select, TextArea, TextField } from '@/shared/ui';
import { documentChoicesQueryOptions } from '../api/builder-api';
import { exportsQueryOptions } from '../../exports/api/exports-api';
import { patchConfig } from '../lib/numbers';
import { fromRecipients } from '../lib/participants';
import { ParticipantList } from './participants/ParticipantList';
import { WholeNumberField } from './WholeNumberField';
import styles from './Builder.module.css';

export interface SectionProps {
  readonly step: StepDocument;
  /** Every block of the version, for settings that point to another one. */
  readonly steps: readonly StepDocument[];
  readonly fields: readonly FieldDocument[];
  readonly readOnly: boolean;
  readonly onChange: (patch: Partial<StepDocument>) => void;
  /** The workflow of the version, for settings that list its own records (documents, exports). */
  readonly workflowId?: string;
}

const FORBIDDEN = 403;
const POSITION_MODES: ReadonlySet<AssignmentMode> = new Set(['POSITION', 'POOL', 'RANDOM_DISPATCH']);
const MANUAL_MODES: ReadonlySet<AssignmentMode> = new Set(['POSITION', 'USERS', 'GROUP', 'POOL']);
const APPROVAL_LEVELS = [1, 2, 3, 4, 5];
const PEOPLE_MODES = ASSIGNMENT_MODES.filter((mode) => mode !== 'NONE');

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A part of the inspector, named by its title (a region a screen reader can jump to). */
function Section({ title, children }: { readonly title: string; readonly children: React.ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.sectionTitle}>
        {title}
      </h3>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

/** Who takes the step: the mode and what that mode needs (a position, an approval type and level, an interval…). */
export function AssignmentSection({ step, steps, readOnly, onChange }: SectionProps) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const positions = useQuery({ ...positionsQueryOptions(client), enabled: POSITION_MODES.has(step.assignmentMode) });
  const approvalTypes = useQuery({ ...approvalTypesQueryOptions(client), enabled: step.assignmentMode === 'APPROVER' || step.assignmentMode === 'PARALLEL' });
  const mode = step.assignmentMode;

  const changeMode = (next: AssignmentMode) =>
    onChange({
      assignmentMode: next,
      positionId: POSITION_MODES.has(next) ? step.positionId : null,
      approvalGroupTypeId: next === 'APPROVER' || next === 'PARALLEL' ? step.approvalGroupTypeId : null,
      approvalLevel: next === 'APPROVER' ? (step.approvalLevel ?? 1) : next === 'PARALLEL' ? step.approvalLevel : null,
      dispatchIntervalMin: next === 'RANDOM_DISPATCH' ? step.dispatchIntervalMin : null,
      manualSelection: MANUAL_MODES.has(next) ? step.manualSelection : false,
      sameAssigneeStepId: next === 'SAME_AS_STEP' ? step.sameAssigneeStepId : null,
    });
  // A step one person delivers: the source of SAME_AS_STEP (the validator also checks it comes before).
  const sources = steps.filter((candidate) => candidate.id !== step.id && PEOPLE_STEP_TYPES.has(candidate.type) && candidate.assignmentMode !== 'PARALLEL');

  return (
    <Section title={t('builder.assignment.title')}>
      <Select
        label={t('builder.assignment.mode')}
        disabled={readOnly}
        options={PEOPLE_MODES.map((value) => ({ value, label: t(`builder.assignment.modes.${value}`) }))}
        value={mode}
        onChange={(event) => changeMode(event.target.value as AssignmentMode)}
      />
      {POSITION_MODES.has(mode) && (
        <Select
          label={t('builder.assignment.position')}
          disabled={readOnly}
          placeholder={t('builder.assignment.positionPlaceholder')}
          options={(positions.data ?? []).filter((position) => position.isActive || position.id === step.positionId).map((position) => ({ value: position.id, label: position.name }))}
          value={step.positionId ?? ''}
          onChange={(event) => onChange({ positionId: event.target.value === '' ? null : event.target.value })}
        />
      )}
      {(mode === 'APPROVER' || mode === 'PARALLEL') && (
        <div className={styles.pair}>
          <Select
            label={t('builder.assignment.approvalType')}
            disabled={readOnly}
            placeholder={t('builder.assignment.approvalTypePlaceholder')}
            options={(approvalTypes.data ?? []).map((type) => ({ value: type.id, label: type.name }))}
            value={step.approvalGroupTypeId ?? ''}
            onChange={(event) => onChange({ approvalGroupTypeId: event.target.value === '' ? null : event.target.value })}
          />
          <Select
            label={t('builder.assignment.approvalLevel')}
            disabled={readOnly}
            {...(mode === 'PARALLEL' ? { placeholder: '—' } : {})}
            options={APPROVAL_LEVELS.map((level) => ({ value: String(level), label: String(level) }))}
            value={step.approvalLevel === null ? '' : String(step.approvalLevel)}
            onChange={(event) => onChange({ approvalLevel: event.target.value === '' ? null : Number(event.target.value) })}
          />
        </div>
      )}
      {mode === 'SAME_AS_STEP' && (
        <Select
          label={t('builder.assignment.sameStep')}
          hint={t('builder.assignment.sameStepHint')}
          disabled={readOnly}
          placeholder={t('builder.assignment.sameStepPlaceholder')}
          options={sources.map((source) => ({ value: source.id, label: source.name }))}
          value={step.sameAssigneeStepId ?? ''}
          onChange={(event) => onChange({ sameAssigneeStepId: event.target.value === '' ? null : event.target.value })}
        />
      )}
      {mode === 'RANDOM_DISPATCH' && (
        <WholeNumberField label={t('builder.assignment.dispatchInterval')} min={1} max={10_080} disabled={readOnly} value={step.dispatchIntervalMin} onChange={(value) => onChange({ dispatchIntervalMin: value })} />
      )}
      {POSITION_MODES.has(mode) && (
        <Select
          label={t('builder.assignment.siteScope')}
          disabled={readOnly}
          options={SITE_SCOPES.map((value) => ({ value, label: t(`builder.assignment.siteScopes.${value}`) }))}
          value={step.siteScope}
          onChange={(event) => onChange({ siteScope: event.target.value as StepDocument['siteScope'] })}
        />
      )}
      {MANUAL_MODES.has(mode) && <Checkbox label={t('builder.assignment.manualSelection')} disabled={readOnly} checked={step.manualSelection} onChange={(event) => onChange({ manualSelection: event.target.checked })} />}
    </Section>
  );
}

/** Deadline, closing, loops, instructions and what each kind of person's step adds. */
export function PeopleSection({ step, readOnly, onChange, workflowId }: SectionProps) {
  const { t } = useTranslation('workflows');
  const config = step.config;
  const setConfig = (patch: Record<string, unknown>) => onChange({ config: patchConfig(config, patch) });
  const batch = (config.batch as { maxTickets?: number } | undefined)?.maxTickets ?? null;
  return (
    <>
      <Section title={t('builder.sla.title')}>
        <div className={styles.pair}>
          <WholeNumberField
            label={t('builder.sla.value')}
            hint={t('builder.sla.hint')}
            min={1}
            disabled={readOnly}
            value={step.slaValue}
            onChange={(value) => onChange(value === null ? { slaValue: null, slaUnit: null } : { slaValue: value, slaUnit: step.slaUnit ?? 'BUSINESS_DAYS' })}
          />
          <Select
            label={t('builder.sla.unit')}
            disabled={readOnly || step.slaValue === null}
            options={SLA_UNITS.map((value) => ({ value, label: t(`builder.sla.units.${value}`) }))}
            value={step.slaUnit ?? 'BUSINESS_DAYS'}
            onChange={(event) => onChange({ slaUnit: event.target.value as StepDocument['slaUnit'] })}
          />
        </div>
      </Section>
      <Section title={t('builder.inspector.stepRules')}>
        <Select
          label={t('builder.closeRule.label')}
          disabled={readOnly}
          options={CLOSE_RULES.map((value) => ({ value, label: t(`builder.closeRule.rules.${value}`) }))}
          value={step.closeRule}
          onChange={(event) => onChange({ closeRule: event.target.value as StepDocument['closeRule'] })}
        />
        <WholeNumberField label={t('builder.maxLoops')} hint={t('builder.maxLoopsHint')} min={1} max={1000} disabled={readOnly} value={step.maxLoops} onChange={(value) => onChange({ maxLoops: value })} />
        <TextArea label={t('builder.instructions')} hint={t('builder.instructionsHint')} maxLength={5000} disabled={readOnly} value={text(config.instructions)} onChange={(event) => setConfig({ instructions: event.target.value === '' ? undefined : event.target.value })} />
        {step.type === 'APPROVAL' && (
          <Checkbox label={t('builder.rejectRequiresComment')} disabled={readOnly} checked={config.rejectRequiresComment !== false} onChange={(event) => setConfig({ rejectRequiresComment: event.target.checked })} />
        )}
        {step.type === 'SIGNATURE' && (
          <Select
            label={t('builder.signature.document')}
            disabled={readOnly}
            options={(['MAIN_DOCUMENT', 'STEP_DOCUMENT'] as const).map((value) => ({ value, label: t(`builder.signature.documents.${value}`) }))}
            value={text(config.document) || 'MAIN_DOCUMENT'}
            onChange={(event) => setConfig({ document: event.target.value })}
          />
        )}
        {(step.type === 'TASK' || step.type === 'APPROVAL') && (
          <>
            <Checkbox
              label={t('builder.batch.allows')}
              disabled={readOnly}
              checked={step.allowsBatch}
              onChange={(event) => onChange(event.target.checked ? { allowsBatch: true } : { allowsBatch: false, config: patchConfig(config, { batch: undefined }) })}
            />
            {step.allowsBatch && (
              <WholeNumberField label={t('builder.batch.max')} min={1} max={500} disabled={readOnly} value={batch} onChange={(value) => setConfig({ batch: value === null ? undefined : { maxTickets: value } })} />
            )}
            <ExportChoice
              label={t('builder.export.required')}
              hint={t('builder.export.requiredHint')}
              placeholder={t('builder.export.notRequired')}
              workflowId={workflowId}
              readOnly={readOnly}
              value={text(config.requiredExportId)}
              onChange={(id) => setConfig({ requiredExportId: id })}
            />
          </>
        )}
      </Section>
    </>
  );
}

const RECIPIENT_KINDS = ['CREATOR', 'ASSIGNEES', 'OBSERVERS'] as const;
const CHANNELS = ['IN_APP', 'EMAIL'] as const;
type Recipient = { readonly kind: string; readonly id?: string };

export function NotificationSection({ step, readOnly, onChange }: SectionProps) {
  const { t } = useTranslation('workflows');
  const config = step.config;
  const setConfig = (patch: Record<string, unknown>) => onChange({ config: patchConfig(config, patch) });
  const recipients = (Array.isArray(config.recipients) ? config.recipients : []) as Recipient[];
  const channels = (Array.isArray(config.channels) ? config.channels : []) as string[];
  const toggleKind = (kind: string, on: boolean) =>
    setConfig({ recipients: on ? [...recipients.filter((recipient) => recipient.kind !== kind), { kind }] : recipients.filter((recipient) => recipient.kind !== kind || recipient.id !== undefined) });
  const toggleChannel = (channel: string, on: boolean) => setConfig({ channels: on ? [...channels.filter((value) => value !== channel), channel] : channels.filter((value) => value !== channel) });
  return (
    <Section title={t('builder.types.NOTIFICATION')}>
      <fieldset className={styles.choices}>
        <legend>{t('builder.notification.recipients')}</legend>
        {RECIPIENT_KINDS.map((kind) => (
          <Checkbox
            key={kind}
            label={t(`builder.notification.kinds.${kind}`)}
            disabled={readOnly}
            checked={recipients.some((recipient) => recipient.kind === kind && recipient.id === undefined)}
            onChange={(event) => toggleKind(kind, event.target.checked)}
          />
        ))}
      </fieldset>
      <fieldset className={styles.choices}>
        <legend>{t('builder.participants.recipients')}</legend>
        <p className={styles.note}>{t('builder.participants.recipientsHint')}</p>
        <ParticipantList
          label={t('builder.participants.recipients')}
          empty={t('builder.participants.recipientsEmpty')}
          kinds={['USER', 'POSITION', 'GROUP']}
          items={fromRecipients(recipients)}
          readOnly={readOnly}
          pending={false}
          onChange={(items) => setConfig({ recipients: [...recipients.filter((recipient) => recipient.id === undefined), ...items.map((item) => ({ kind: item.kind, id: item.id }))] })}
        />
      </fieldset>
      <fieldset className={styles.choices}>
        <legend>{t('builder.notification.channels')}</legend>
        {CHANNELS.map((channel) => (
          <Checkbox key={channel} label={t(`builder.notification.channelNames.${channel}`)} disabled={readOnly} checked={channels.includes(channel)} onChange={(event) => toggleChannel(channel, event.target.checked)} />
        ))}
      </fieldset>
      <TextField label={t('builder.notification.subject')} maxLength={200} disabled={readOnly} value={text(config.subject)} onChange={(event) => setConfig({ subject: event.target.value })} />
      <TextArea
        label={t('builder.notification.body')}
        hint={t('builder.notification.placeholdersHint', { example: '{{ticket.number}}, {{ticket.title}}' })}
        maxLength={10_000}
        rows={5}
        disabled={readOnly}
        value={text(config.body)}
        onChange={(event) => setConfig({ body: event.target.value })}
      />
    </Section>
  );
}

const dateFieldsOf = (fields: readonly FieldDocument[]) => fields.filter((field) => ['DATE', 'DATETIME'].includes(effectiveFieldType(field)));

export function WaitSection({ step, fields, readOnly, onChange }: SectionProps) {
  const { t } = useTranslation('workflows');
  const config = step.config;
  const mode = text(config.mode) || 'DURATION';
  const dateFields = dateFieldsOf(fields);
  const changeMode = (next: string) =>
    onChange({
      config:
        next === 'DURATION'
          ? { mode: 'DURATION', value: 1, unit: 'BUSINESS_DAYS' }
          : next === 'UNTIL_FIELD_DATE'
            ? { mode: 'UNTIL_FIELD_DATE', fieldCode: dateFields[0]?.code ?? '', offsetBusinessDays: 0 }
            : { mode: 'COMPANY_CUTOFF' },
    });
  // Waiting for the company's cutoff is in the model but the engine does not run it: it is only shown if already chosen.
  const modes = mode === 'COMPANY_CUTOFF' ? ['DURATION', 'UNTIL_FIELD_DATE', 'COMPANY_CUTOFF'] : ['DURATION', 'UNTIL_FIELD_DATE'];
  return (
    <Section title={t('builder.types.WAIT')}>
      <Select
        label={t('builder.wait.mode')}
        disabled={readOnly}
        options={modes.map((value) => ({ value, label: t(`builder.wait.modes.${value as 'DURATION'}`) }))}
        value={mode}
        onChange={(event) => changeMode(event.target.value)}
      />
      {mode === 'DURATION' && (
        <div className={styles.pair}>
          <WholeNumberField label={t('builder.wait.value')} min={1} max={3000} disabled={readOnly} value={typeof config.value === 'number' ? config.value : null} onChange={(value) => onChange({ config: patchConfig(config, { value: value ?? undefined }) })} />
          <Select
            label={t('builder.wait.unit')}
            disabled={readOnly}
            options={SLA_UNITS.map((value) => ({ value, label: t(`builder.sla.units.${value}`) }))}
            value={text(config.unit) || 'BUSINESS_DAYS'}
            onChange={(event) => onChange({ config: patchConfig(config, { unit: event.target.value }) })}
          />
        </div>
      )}
      {mode === 'UNTIL_FIELD_DATE' &&
        (dateFields.length === 0 ? (
          <p className={styles.note}>{t('builder.wait.noDateFields')}</p>
        ) : (
          <>
            <Select
              label={t('builder.wait.field')}
              disabled={readOnly}
              placeholder={t('builder.wait.fieldPlaceholder')}
              options={dateFields.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
              value={text(config.fieldCode)}
              onChange={(event) => onChange({ config: patchConfig(config, { fieldCode: event.target.value }) })}
            />
            <WholeNumberField
              label={t('builder.wait.offset')}
              min={-365}
              max={365}
              disabled={readOnly}
              value={typeof config.offsetBusinessDays === 'number' ? config.offsetBusinessDays : 0}
              onChange={(value) => onChange({ config: patchConfig(config, { offsetBusinessDays: value ?? 0 }) })}
            />
          </>
        ))}
    </Section>
  );
}

export function DocumentSection({ step, readOnly, onChange, workflowId }: SectionProps & { readonly workflowId: string }) {
  const { t } = useTranslation('workflows');
  const documents = useQuery(documentChoicesQueryOptions(useApiClient(), workflowId));
  const config = step.config;
  const forbidden = documents.error instanceof ApiError && documents.error.status === FORBIDDEN;
  return (
    <Section title={t('builder.types.DOCUMENT')}>
      {forbidden ? (
        <p className={styles.note}>{t('builder.document.forbidden')}</p>
      ) : documents.data !== undefined && documents.data.length === 0 ? (
        <p className={styles.note}>{t('builder.document.none')}</p>
      ) : (
        <Select
          label={t('builder.document.source')}
          disabled={readOnly}
          placeholder={t('builder.document.placeholder')}
          options={(documents.data ?? []).map((document) => ({ value: document.id, label: document.isActive ? document.name : t('builder.document.inactive', { name: document.name }) }))}
          value={text(config.workflowDocumentId)}
          onChange={(event) => onChange({ config: patchConfig(config, { workflowDocumentId: event.target.value === '' ? undefined : event.target.value }) })}
        />
      )}
      <Select
        label={t('builder.document.role')}
        disabled={readOnly}
        options={(['MAIN_DOCUMENT', 'STEP_DOCUMENT'] as const).map((value) => ({ value, label: t(`builder.document.roles.${value}`) }))}
        value={text(config.role) || 'MAIN_DOCUMENT'}
        onChange={(event) => onChange({ config: patchConfig(config, { role: event.target.value }) })}
      />
    </Section>
  );
}

const INPUT_TYPES: Readonly<Record<string, ReadonlySet<string>>> = {
  DATETIME: new Set(['DATETIME']),
  DATE: new Set(['DATE']),
  NUMBER: new Set(['NUMBER', 'CURRENCY', 'DAYS']),
  TEXT: new Set(['TEXT', 'TEXTAREA', 'SELECT']),
};

export function CalculatorSection({ step, fields, readOnly, onChange }: SectionProps) {
  const { t } = useTranslation('workflows');
  const config = step.config;
  const code = text(config.calculatorCode);
  const inputs = (config.inputs ?? {}) as Record<string, string>;
  const calculator = listCalculators().find((candidate) => candidate.code === code);
  const outputs = fields.filter((field) => field.type === 'NUMBER' || field.type === 'CURRENCY');
  return (
    <Section title={t('builder.types.CALCULATOR')}>
      <Select
        label={t('builder.calculator.calculator')}
        disabled={readOnly}
        placeholder={t('builder.calculator.placeholder')}
        options={listCalculators().map((candidate) => ({ value: candidate.code, label: t(`builder.calculator.names.${candidate.code as 'MEAL_ALLOWANCE'}`, { defaultValue: candidate.code }) }))}
        value={code}
        onChange={(event) => onChange({ config: event.target.value === '' ? {} : { calculatorCode: event.target.value, inputs: {}, outputFieldCode: text(config.outputFieldCode) } })}
      />
      {calculator?.parameters.map((parameter) => (
        <Select
          key={parameter.name}
          label={t('builder.calculator.input', { name: parameter.name })}
          disabled={readOnly}
          placeholder={t('builder.calculator.inputPlaceholder')}
          options={fields.filter((field) => INPUT_TYPES[parameter.type]?.has(effectiveFieldType(field)) === true).map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
          value={inputs[parameter.name] ?? ''}
          onChange={(event) => onChange({ config: patchConfig(config, { inputs: patchConfig(inputs, { [parameter.name]: event.target.value === '' ? undefined : event.target.value }) }) })}
        />
      ))}
      {calculator !== undefined && (
        <Select
          label={t('builder.calculator.output')}
          hint={t('builder.calculator.outputHint')}
          disabled={readOnly}
          placeholder={t('builder.calculator.inputPlaceholder')}
          options={outputs.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
          value={text(config.outputFieldCode)}
          onChange={(event) => onChange({ config: patchConfig(config, { outputFieldCode: event.target.value }) })}
        />
      )}
    </Section>
  );
}

export { Section };

/** One of the workflow's exports ("planos"); hidden to a role that cannot read them. */
function ExportChoice({ label, hint, placeholder, workflowId, readOnly, value, onChange }: { readonly label: string; readonly hint?: string; readonly placeholder: string; readonly workflowId: string | undefined; readonly readOnly: boolean; readonly value: string; readonly onChange: (id: string | undefined) => void }) {
  const { t } = useTranslation('workflows');
  const canRead = usePermissions().can('read', 'Export');
  const exports = useQuery({ ...exportsQueryOptions(useApiClient()), enabled: canRead });
  if (!canRead) return value === '' ? null : <p className={styles.note}>{t('builder.export.forbidden')}</p>;
  const options = (exports.data ?? []).filter((definition) => definition.workflowId === workflowId || definition.id === value).map((definition) => ({ value: definition.id, label: definition.name }));
  return (
    <Select
      label={label}
      {...(hint === undefined ? {} : { hint })}
      disabled={readOnly}
      placeholder={exports.data !== undefined && options.length === 0 ? t('builder.export.none') : placeholder}
      options={options}
      value={value}
      onChange={(event) => onChange(event.target.value === '' ? undefined : event.target.value)}
    />
  );
}

/** The EXPORT block: which export the ticket writes its line into when it goes through. */
export function ExportSection({ step, readOnly, onChange, workflowId }: SectionProps) {
  const { t } = useTranslation('workflows');
  return (
    <Section title={t('builder.types.EXPORT')}>
      <ExportChoice
        label={t('builder.export.source')}
        hint={t('builder.export.sourceHint')}
        placeholder={t('builder.export.choose')}
        workflowId={workflowId}
        readOnly={readOnly}
        value={text(step.config.exportDefinitionId)}
        onChange={(id) => onChange({ config: patchConfig(step.config, { exportDefinitionId: id }) })}
      />
    </Section>
  );
}
