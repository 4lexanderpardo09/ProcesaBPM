import { isAutomaticStep, type StepType, type TransitionDocument, type TransitionType, type WorkflowVersionDocument } from '@procesabpm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Select, TextField } from '@/shared/ui';
import type { ElementProblems } from '../lib/problems';
import { ConditionEditor } from './ConditionEditor';
import { ProblemList } from './ProblemList';
import { Section } from './StepSections';
import styles from './Builder.module.css';

export interface TransitionInspectorProps {
  readonly transition: TransitionDocument;
  readonly doc: WorkflowVersionDocument;
  readonly readOnly: boolean;
  readonly problems: ElementProblems;
  readonly onChange: (patch: Partial<TransitionDocument>) => void;
  readonly onRemove: () => void;
}

/** The types a way out of this block may have (mirror of the database's `validate_transition`). */
function typesFor(fromType: StepType | undefined): TransitionType[] {
  if (fromType === undefined) return [];
  if (fromType === 'CONDITION') return ['CONDITION', 'DEFAULT'];
  if (isAutomaticStep(fromType)) return ['DEFAULT'];
  return ['DECISION', 'SYSTEM_ONLY'];
}

/** One way out: its name, its type and, for a branch of a condition, its rules. */
export function TransitionInspector({ transition, doc, readOnly, problems, onChange, onRemove }: TransitionInspectorProps) {
  const { t } = useTranslation('workflows');
  const [label, setLabel] = useState(transition.label);
  useEffect(() => setLabel(transition.label), [transition.id, transition.label]);
  const from = doc.steps.find((step) => step.id === transition.fromStepId);
  const to = doc.steps.find((step) => step.id === transition.toStepId);
  const types = typesFor(from?.type);

  return (
    <div className={styles.inspectorBody}>
      <header className={styles.inspectorHeader}>
        <span className="text-overline">{t('builder.connection.title')}</span>
        <h2 className={styles.inspectorTitle}>{t('builder.connection.route', { from: from?.name ?? '', to: to?.name ?? '' })}</h2>
      </header>
      <ProblemList problems={problems} />
      <Section title={t('builder.inspector.general')}>
        <TextField
          label={t('builder.connection.label')}
          hint={t('builder.connection.labelHint')}
          required
          maxLength={200}
          disabled={readOnly}
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            if (event.target.value.trim() !== '') onChange({ label: event.target.value });
          }}
          onBlur={() => setLabel(transition.label)}
        />
        <Select
          label={t('builder.connection.type')}
          hint={t(`builder.connection.typeHints.${transition.type}`)}
          disabled={readOnly || types.length <= 1}
          options={(types.includes(transition.type) ? types : [transition.type, ...types]).map((type) => ({ value: type, label: t(`builder.connection.types.${type}`) }))}
          value={transition.type}
          onChange={(event) => {
            const type = event.target.value as TransitionType;
            onChange({ type, condition: type === 'CONDITION' ? transition.condition : null });
          }}
        />
      </Section>
      {transition.type === 'CONDITION' && (
        <Section title={t('builder.connection.types.CONDITION')}>
          <ConditionEditor condition={transition.condition} fields={doc.fields} readOnly={readOnly} onChange={(condition) => onChange({ condition })} />
        </Section>
      )}
      {!readOnly && (
        <Button variant="ghost" onClick={onRemove}>
          {t('builder.inspector.removeConnection')}
        </Button>
      )}
    </div>
  );
}
