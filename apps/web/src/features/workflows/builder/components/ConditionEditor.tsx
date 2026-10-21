import type { ConditionOperator, FieldDocument, TransitionCondition } from '@procesabpm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, PlusIcon, Select, TextField } from '@/shared/ui';
import { type ConditionRule, operatorsFor, optionsOf, parseList, ruleFor, valueKind, withOperator } from '../lib/condition-rules';
import styles from './Builder.module.css';

export interface ConditionEditorProps {
  readonly condition: TransitionCondition | null;
  readonly fields: readonly FieldDocument[];
  readonly readOnly: boolean;
  /** `null` when no rule is complete: the branch then reports that it needs one. */
  readonly onChange: (condition: TransitionCondition | null) => void;
}

/**
 * The rules of a branch, all of which must hold. A rule only reaches the document once its field is chosen (with a value
 * of the right kind), so the canvas can always be saved; a row still without a field lives here only.
 */
export function ConditionEditor({ condition, fields, readOnly, onChange }: ConditionEditorProps) {
  const { t } = useTranslation('workflows');
  const rules = condition ?? [];
  const [pending, setPending] = useState(0);
  const fieldByCode = new Map(fields.map((field) => [field.code, field]));
  const replace = (index: number, rule: ConditionRule) => onChange(rules.map((current, at) => (at === index ? rule : current)));
  const remove = (index: number) => {
    const next = rules.filter((_rule, at) => at !== index);
    onChange(next.length === 0 ? null : next);
  };

  if (fields.length === 0) return <p className={styles.note}>{t('builder.condition.noFields')}</p>;
  return (
    <fieldset className={styles.choices}>
      <legend>{t('builder.condition.title')}</legend>
      <ol className={styles.rules}>
        {rules.map((rule, index) => {
          const field = fieldByCode.get(rule.field);
          return (
            <li key={`${String(index)}-${rule.field}`} className={styles.rule}>
              <span className={styles.ruleTitle}>{t('builder.condition.rule', { index: index + 1 })}</span>
              <FieldSelect fields={fields} value={rule.field} readOnly={readOnly} onChange={(next) => replace(index, ruleFor(next))} />
              {field !== undefined && (
                <>
                  <Select
                    label={t('builder.condition.operator')}
                    disabled={readOnly}
                    options={operatorsFor(field).map((operator) => ({ value: operator, label: t(`builder.condition.operators.${operator}`) }))}
                    value={rule.op}
                    onChange={(event) => replace(index, withOperator(rule, field, event.target.value as ConditionOperator))}
                  />
                  <RuleValue rule={rule} field={field} readOnly={readOnly} onChange={(value) => replace(index, { ...rule, value })} />
                </>
              )}
              {!readOnly && (
                <Button variant="ghost" onClick={() => remove(index)}>
                  {t('builder.condition.remove', { index: index + 1 })}
                </Button>
              )}
            </li>
          );
        })}
        {Array.from({ length: pending }, (_unused, offset) => (
          <li key={`pending-${String(offset)}`} className={styles.rule}>
            <span className={styles.ruleTitle}>{t('builder.condition.rule', { index: rules.length + offset + 1 })}</span>
            <FieldSelect
              fields={fields}
              value=""
              readOnly={readOnly}
              onChange={(field) => {
                setPending((count) => count - 1);
                onChange([...rules, ruleFor(field)]);
              }}
            />
          </li>
        ))}
      </ol>
      {!readOnly && rules.length + pending < 20 && (
        <Button icon={<PlusIcon size={14} />} onClick={() => setPending((count) => count + 1)}>
          {t('builder.condition.add')}
        </Button>
      )}
    </fieldset>
  );
}

function FieldSelect({ fields, value, readOnly, onChange }: { readonly fields: readonly FieldDocument[]; readonly value: string; readonly readOnly: boolean; readonly onChange: (field: FieldDocument) => void }) {
  const { t } = useTranslation('workflows');
  return (
    <Select
      label={t('builder.condition.field')}
      disabled={readOnly}
      placeholder={t('builder.condition.fieldPlaceholder')}
      options={fields.map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
      value={value}
      onChange={(event) => {
        const field = fields.find((candidate) => candidate.code === event.target.value);
        if (field !== undefined) onChange(field);
      }}
    />
  );
}

function RuleValue({ rule, field, readOnly, onChange }: { readonly rule: ConditionRule; readonly field: FieldDocument; readonly readOnly: boolean; readonly onChange: (value: ConditionRule['value']) => void }) {
  const { t } = useTranslation('workflows');
  const kind = valueKind(field, rule.op);
  const label = t('builder.condition.value');
  if (kind === 'option') {
    return <Select label={label} disabled={readOnly} options={optionsOf(field)} value={String(rule.value)} onChange={(event) => onChange(event.target.value)} />;
  }
  if (kind === 'date') {
    return <TextField label={label} type="date" disabled={readOnly} value={String(rule.value).slice(0, 10)} onChange={(event) => event.target.value !== '' && onChange(event.target.value)} />;
  }
  if (kind === 'list') {
    return <TypedText label={label} hint={t('builder.condition.listHint')} readOnly={readOnly} value={Array.isArray(rule.value) ? rule.value.join(', ') : String(rule.value)} parse={(text) => parseList(text, valueKind(field, 'equals') === 'number')} onChange={onChange} />;
  }
  if (kind === 'number') {
    return <TypedText label={label} inputMode="decimal" readOnly={readOnly} value={String(rule.value)} parse={(text) => (text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : undefined)} onChange={onChange} />;
  }
  return <TextField label={label} maxLength={1000} disabled={readOnly} value={String(rule.value)} onChange={(event) => onChange(event.target.value)} />;
}

interface TypedTextProps {
  readonly label: string;
  readonly hint?: string;
  readonly inputMode?: 'decimal';
  readonly readOnly: boolean;
  readonly value: string;
  /** `undefined` while what is typed is not a value yet ("1." on the way to "1.5"). */
  readonly parse: (text: string) => ConditionRule['value'] | undefined;
  readonly onChange: (value: ConditionRule['value']) => void;
}

/** A box whose text is kept as typed, while the rule gets the parsed value. */
function TypedText({ label, hint, inputMode, readOnly, value, parse, onChange }: TypedTextProps) {
  const [text, setText] = useState(value);
  useEffect(() => {
    setText((current) => (JSON.stringify(parse(current)) === JSON.stringify(parse(value)) ? current : value));
    // `parse` is a new function on each render; only an outside change of the value matters here.
  }, [value]);
  return (
    <TextField
      label={label}
      {...(hint === undefined ? {} : { hint })}
      {...(inputMode === undefined ? {} : { inputMode })}
      disabled={readOnly}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        const parsed = parse(event.target.value);
        if (parsed !== undefined) onChange(parsed);
      }}
    />
  );
}
