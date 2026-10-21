import { type AmountRuleDocument, effectiveFieldType, type FieldDocument, isNewRef, type WorkflowVersionDocument } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Checkbox, Dialog, PlusIcon, Select, TextArea, TextField } from '@/shared/ui';
import { WorkflowError } from '../../components/WorkflowError';
import type { DraftContent } from '../hooks/use-draft-content';
import { useRecordNames } from '../hooks/use-record-names';
import { isPeopleStep } from '../lib/block-catalog';
import { removeAmountRule, upsertAmountRule } from '../lib/content-doc';
import styles from './Builder.module.css';

const CURRENCIES = ['COP', 'USD', 'EUR'];
const ACTIONS = ['BLOCK', 'WARN', 'EXTRA_APPROVAL'] as const;
const AMOUNT = /^\d{1,16}(\.\d{1,2})?$/;

type Columns = ReadonlyArray<{ readonly code: string; readonly label: string; readonly type: string }>;
const columnsOf = (field: FieldDocument | undefined): Columns => (field?.type === 'TABLE' && Array.isArray(field.config.columns) ? (field.config.columns as Columns) : []);
const amountFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
/** "2000000.00" as "2.000.000": the API keeps money as a decimal string. */
const formatAmount = (amount: string) => (Number.isFinite(Number(amount)) ? amountFormat.format(Number(amount)) : amount);
const isAmountField = (field: FieldDocument) => field.type === 'TABLE' || ['NUMBER', 'CURRENCY'].includes(effectiveFieldType(field));

export interface AmountRulesDialogProps {
  readonly doc: WorkflowVersionDocument;
  readonly readOnly: boolean;
  readonly content: DraftContent;
  /** Adds the system-only way from the checked step to its extra approval (a change of the canvas, saved with it). */
  readonly onWire: (fromId: string, toId: string) => void;
  readonly onClose: () => void;
}

type View = { readonly kind: 'list' } | { readonly kind: 'edit'; readonly rule: AmountRuleDocument | null } | { readonly kind: 'remove'; readonly rule: AmountRuleDocument };

/** The amount caps of the version: a list to read, and a form to add or change one. */
export function AmountRulesDialog({ doc, readOnly, content, onWire, onClose }: AmountRulesDialogProps) {
  const { t } = useTranslation('workflows');
  const [view, setView] = useState<View>({ kind: 'list' });
  const fieldName = (code: string) => doc.fields.find((field) => field.code === code)?.label ?? code;
  const stepName = (id: string | null) => doc.steps.find((step) => step.id === id)?.name ?? '';
  const wired = (rule: AmountRuleDocument) => doc.transitions.some((transition) => transition.type === 'SYSTEM_ONLY' && transition.fromStepId === rule.stepId && transition.toStepId === rule.approvalStepId);
  const go = (next: View) => {
    content.reset();
    setView(next);
  };

  if (view.kind === 'edit') return <AmountRuleForm doc={doc} rule={view.rule} content={content} onDone={() => go({ kind: 'list' })} />;
  if (view.kind === 'remove') {
    return (
      <Dialog
        open
        title={t('builder.amountRules.removeTitle')}
        closeLabel={t('close')}
        onClose={() => go({ kind: 'list' })}
        footer={
          <>
            <Button onClick={() => go({ kind: 'list' })}>{t('cancel')}</Button>
            <Button
              variant="brand"
              disabled={content.pending}
              onClick={() => void content.run({ call: (api) => api.deleteAmountRule(view.rule.id), apply: (current) => removeAmountRule(current, view.rule.id) }).then((ok) => ok && setView({ kind: 'list' }))}
            >
              {t('builder.amountRules.remove')}
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <p className={styles.note}>{t('builder.amountRules.removeBody', { field: fieldName(view.rule.fieldCode) })}</p>
          <WorkflowError error={content.error} context="content" />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog open title={t('builder.amountRules.title')} closeLabel={t('close')} onClose={onClose} footer={<Button onClick={onClose}>{t('builder.amountRules.close')}</Button>}>
      <div className={styles.dialogBody}>
        <p className={styles.note}>{t('builder.amountRules.hint')}</p>
        {doc.amountRules.length === 0 ? (
          <p className={styles.note}>{t('builder.amountRules.empty')}</p>
        ) : (
          <ul className={styles.fieldList} aria-label={t('builder.amountRules.label')}>
            {doc.amountRules.map((rule) => {
              const field = fieldName(rule.fieldCode);
              return (
                <li key={rule.id} className={styles.fieldRow}>
                  <span className={styles.fieldText}>
                    <span className={styles.fieldName}>{t('builder.amountRules.summary', { field, amount: formatAmount(rule.maxAmount), currency: rule.currencyCode, action: t(`builder.amountRules.actions.${rule.action}`) })}</span>
                    <span className={styles.fieldMetaPlain}>
                      {rule.stepId === null ? t('builder.amountRules.anyStep') : t('builder.amountRules.atStep', { step: stepName(rule.stepId) })}
                      {rule.action === 'EXTRA_APPROVAL' && rule.approvalStepId !== null ? ` → ${stepName(rule.approvalStepId)}` : ''}
                    </span>
                    {!rule.isActive && (
                      <span className={styles.fieldBadges}>
                        <Badge>{t('builder.amountRules.inactive')}</Badge>
                      </span>
                    )}
                  </span>
                  {!readOnly && (
                    <span className={styles.fieldActions}>
                      {rule.action === 'EXTRA_APPROVAL' && rule.stepId !== null && rule.approvalStepId !== null && !wired(rule) && (
                        <Button variant="ghost" aria-label={t('builder.amountRules.wireNamed', { from: stepName(rule.stepId), to: stepName(rule.approvalStepId) })} onClick={() => rule.stepId !== null && rule.approvalStepId !== null && onWire(rule.stepId, rule.approvalStepId)}>
                          {t('builder.amountRules.wire')}
                        </Button>
                      )}
                      <Button variant="ghost" aria-label={t('builder.amountRules.editNamed', { field })} onClick={() => go({ kind: 'edit', rule })}>
                        {t('builder.amountRules.edit')}
                      </Button>
                      <Button variant="ghost" aria-label={t('builder.amountRules.removeNamed', { field })} onClick={() => go({ kind: 'remove', rule })}>
                        {t('builder.amountRules.remove')}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {!readOnly && (
          <div>
            <Button icon={<PlusIcon size={14} />} onClick={() => go({ kind: 'edit', rule: null })}>
              {t('builder.amountRules.add')}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function AmountRuleForm({ doc, rule, content, onDone }: { readonly doc: WorkflowVersionDocument; readonly rule: AmountRuleDocument | null; readonly content: DraftContent; readonly onDone: () => void }) {
  const { t } = useTranslation('workflows');
  const { records } = useRecordNames(new Set(['POSITION', 'COMPANY']), []);
  const amountFields = doc.fields.filter(isAmountField);
  // Rules point at saved blocks (the API keeps them by id).
  const peopleSteps = doc.steps.filter((step) => isPeopleStep(step.type) && !isNewRef(step.id));
  const [fieldCode, setFieldCode] = useState(rule?.fieldCode ?? '');
  const [amountColumn, setAmountColumn] = useState(rule?.amountColumn ?? '');
  const [typeColumn, setTypeColumn] = useState(rule?.typeColumn ?? '');
  const [rowTypeValue, setRowTypeValue] = useState(rule?.rowTypeValue ?? '');
  const [maxAmount, setMaxAmount] = useState(rule?.maxAmount ?? '');
  const [currencyCode, setCurrency] = useState(rule?.currencyCode ?? 'COP');
  const [action, setAction] = useState<AmountRuleDocument['action']>(rule?.action ?? 'BLOCK');
  const [stepId, setStepId] = useState(rule?.stepId ?? '');
  const [approvalStepId, setApprovalStepId] = useState(rule?.approvalStepId ?? '');
  const [positionId, setPositionId] = useState(rule?.positionId ?? '');
  const [companyId, setCompanyId] = useState(rule?.companyId ?? '');
  const [message, setMessage] = useState(rule?.message ?? '');
  const [isActive, setActive] = useState(rule?.isActive ?? true);
  const [problem, setProblem] = useState<'required' | 'needsStep' | null>(null);
  const field = doc.fields.find((candidate) => candidate.code === fieldCode);
  const columns = columnsOf(field);
  const nullable = (value: string) => (value === '' ? null : value);

  const submit = async () => {
    const amount = maxAmount.trim().replace(',', '.');
    if (field === undefined || !AMOUNT.test(amount) || Number(amount) <= 0 || (field.type === 'TABLE' && amountColumn === '')) return setProblem('required');
    if (action === 'EXTRA_APPROVAL' && (stepId === '' || approvalStepId === '')) return setProblem('needsStep');
    setProblem(null);
    const isTable = field.type === 'TABLE';
    const body = {
      fieldCode,
      maxAmount: amount,
      currencyCode,
      action,
      stepId: nullable(stepId),
      approvalStepId: action === 'EXTRA_APPROVAL' ? nullable(approvalStepId) : null,
      positionId: nullable(positionId),
      companyId: nullable(companyId),
      amountColumn: isTable ? nullable(amountColumn) : null,
      typeColumn: isTable ? nullable(typeColumn) : null,
      rowTypeValue: isTable && typeColumn !== '' ? nullable(rowTypeValue.trim()) : null,
      message: nullable(message.trim()),
      isActive,
    };
    const ok = await content.run(rule === null ? { call: (api) => api.createAmountRule(body), apply: upsertAmountRule } : { call: (api) => api.updateAmountRule(rule.id, body), apply: upsertAmountRule });
    if (ok) onDone();
  };

  return (
    <Dialog
      open
      title={rule === null ? t('builder.amountRules.createTitle') : t('builder.amountRules.editTitle')}
      closeLabel={t('close')}
      onClose={onDone}
      onSubmit={(event) => {
        event.preventDefault();
        if (!content.pending) void submit();
      }}
      footer={
        <>
          <Button onClick={onDone}>{t('cancel')}</Button>
          <Button type="submit" variant="brand" disabled={content.pending || amountFields.length === 0}>
            {content.pending ? t('saving') : t('builder.amountRules.submit')}
          </Button>
        </>
      }
    >
      <div className={styles.dialogBody}>
        {amountFields.length === 0 ? (
          <p className={styles.note}>{t('builder.amountRules.noAmountFields')}</p>
        ) : (
          <>
            <Select
              label={t('builder.amountRules.field')}
              placeholder={t('builder.amountRules.fieldPlaceholder')}
              options={amountFields.map((candidate) => ({ value: candidate.code, label: `${candidate.label} (${candidate.code})` }))}
              value={fieldCode}
              onChange={(event) => {
                setFieldCode(event.target.value);
                setAmountColumn('');
                setTypeColumn('');
              }}
            />
            {field?.type === 'TABLE' && (
              <>
                <Select
                  label={t('builder.amountRules.amountColumn')}
                  placeholder={t('builder.amountRules.fieldPlaceholder')}
                  options={columns.filter((column) => column.type === 'NUMBER' || column.type === 'CURRENCY').map((column) => ({ value: column.code, label: column.label }))}
                  value={amountColumn}
                  onChange={(event) => setAmountColumn(event.target.value)}
                />
                <div className={styles.pair}>
                  <Select
                    label={t('builder.amountRules.typeColumn')}
                    placeholder={t('builder.amountRules.typeColumnNone')}
                    options={columns.map((column) => ({ value: column.code, label: column.label }))}
                    value={typeColumn}
                    onChange={(event) => setTypeColumn(event.target.value)}
                  />
                  {typeColumn !== '' && <TextField label={t('builder.amountRules.rowTypeValue')} maxLength={200} value={rowTypeValue} onChange={(event) => setRowTypeValue(event.target.value)} />}
                </div>
              </>
            )}
            <div className={styles.pair}>
              <TextField label={t('builder.amountRules.maxAmount')} hint={t('builder.amountRules.maxAmountHint')} inputMode="decimal" value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} />
              <Select label={t('builder.amountRules.currency')} options={CURRENCIES.map((code) => ({ value: code, label: code }))} value={currencyCode} onChange={(event) => setCurrency(event.target.value)} />
            </div>
            <Select label={t('builder.amountRules.action')} options={ACTIONS.map((value) => ({ value, label: t(`builder.amountRules.actions.${value}`) }))} value={action} onChange={(event) => setAction(event.target.value as AmountRuleDocument['action'])} />
            <Select
              label={t('builder.amountRules.step')}
              placeholder={t('builder.amountRules.anyStep')}
              options={peopleSteps.map((step) => ({ value: step.id, label: step.name }))}
              value={stepId}
              onChange={(event) => setStepId(event.target.value)}
            />
            {action === 'EXTRA_APPROVAL' && (
              <Select
                label={t('builder.amountRules.approvalStep')}
                placeholder={t('builder.amountRules.approvalStepPlaceholder')}
                options={peopleSteps.filter((step) => step.id !== stepId).map((step) => ({ value: step.id, label: step.name }))}
                value={approvalStepId}
                onChange={(event) => setApprovalStepId(event.target.value)}
              />
            )}
            <div className={styles.pair}>
              <Select
                label={t('builder.amountRules.position')}
                placeholder={t('builder.amountRules.everyone')}
                options={records.POSITION.filter((record) => record.isActive || record.id === positionId).map((record) => ({ value: record.id, label: record.name }))}
                value={positionId}
                onChange={(event) => setPositionId(event.target.value)}
              />
              <Select
                label={t('builder.amountRules.company')}
                placeholder={t('builder.amountRules.everyone')}
                options={records.COMPANY.filter((record) => record.isActive || record.id === companyId).map((record) => ({ value: record.id, label: record.name }))}
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
              />
            </div>
            <TextArea label={t('builder.amountRules.message')} hint={t('builder.amountRules.messageHint')} maxLength={500} rows={2} value={message} onChange={(event) => setMessage(event.target.value)} />
            <Checkbox label={t('builder.amountRules.active')} checked={isActive} onChange={(event) => setActive(event.target.checked)} />
          </>
        )}
        {problem !== null && <Alert tone="danger">{t(`builder.amountRules.${problem}`)}</Alert>}
        <WorkflowError error={content.error} context="content" />
      </div>
    </Dialog>
  );
}
