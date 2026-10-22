import { isNewRef, type StepDocument, type WorkflowVersionDocument } from '@procesabpm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { Alert, Button, Select, TextArea, TextField } from '@/shared/ui';
import { BLOCK_COLOR, isPeopleStep, NOT_AVAILABLE_TYPES } from '../lib/block-catalog';
import type { Selection } from '../lib/builder-doc';
import type { DraftContent } from '../hooks/use-draft-content';
import type { ElementProblems } from '../lib/problems';
import { FieldsSection } from './fields/FieldsSection';
import { ParticipantsSection } from './participants/ParticipantsSection';
import { ProblemList } from './ProblemList';
import { AssignmentSection, CalculatorSection, DocumentSection, ExportSection, NotificationSection, PeopleSection, Section, WaitSection } from './StepSections';
import styles from './Builder.module.css';

export interface StepInspectorProps {
  readonly step: StepDocument;
  readonly doc: WorkflowVersionDocument;
  readonly workflowId: string;
  readonly readOnly: boolean;
  readonly problems: ElementProblems;
  readonly onChange: (patch: Partial<StepDocument>) => void;
  readonly onRemove: () => void;
  readonly onConnect: (toId: string) => void;
  readonly onSelect: (selection: Selection) => void;
  readonly content: DraftContent;
  /** Content edits wait while the canvas is being saved (both change the revision). */
  readonly saving: boolean;
  readonly onSave: () => void;
}

/** Everything about one block: its name, who takes it and its deadline, what its type adds, its ways out and its problems. */
export function StepInspector({ step, doc, workflowId, readOnly, problems, onChange, onRemove, onConnect, onSelect, content, saving, onSave }: StepInspectorProps) {
  const { t } = useTranslation('workflows');
  const [name, setName] = useState(step.name);
  useEffect(() => setName(step.name), [step.id, step.name]);
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const fieldsHere = doc.fields.filter((field) => field.stepId === step.id).length;
  const exits = doc.transitions.filter((transition) => transition.fromStepId === step.id);
  const nameOf = (id: string) => doc.steps.find((candidate) => candidate.id === id)?.name ?? '';
  const section = { step, steps: doc.steps, fields: doc.fields, readOnly, onChange, workflowId };

  return (
    <div className={styles.inspectorBody}>
      <header className={styles.inspectorHeader} style={{ ['--block-color' as string]: BLOCK_COLOR[step.type] }}>
        <span className={cx('text-overline', styles.kind)}>{t(`builder.types.${step.type}`)}</span>
        <h2 className={styles.inspectorTitle}>{step.name}</h2>
      </header>
      <ProblemList problems={problems} />
      {NOT_AVAILABLE_TYPES.has(step.type) && <Alert tone="warn">{t('builder.notAvailable')}</Alert>}

      <Section title={t('builder.inspector.general')}>
        <TextField
          label={t('builder.inspector.name')}
          required
          maxLength={200}
          disabled={readOnly}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            // A block always keeps a name (the API refuses an empty one): an emptied box changes nothing until typed again.
            if (event.target.value.trim() !== '') onChange({ name: event.target.value });
          }}
          onBlur={() => setName(step.name)}
        />
        <TextArea label={t('builder.inspector.description')} maxLength={2000} rows={2} disabled={readOnly} value={step.description ?? ''} onChange={(event) => onChange({ description: event.target.value === '' ? null : event.target.value })} />
        {step.type === 'START' && <p className={styles.note}>{t('builder.start')}</p>}
        {step.type === 'END' && <p className={styles.note}>{t('builder.end')}</p>}
        {fieldsHere > 0 && <p className={styles.note}>{t('builder.inspector.fieldsCount', { count: fieldsHere })}</p>}
      </Section>

      {isPeopleStep(step.type) && (
        <>
          <AssignmentSection {...section} />
          <PeopleSection {...section} />
        </>
      )}
      {step.type === 'NOTIFICATION' && <NotificationSection {...section} />}
      {step.type === 'WAIT' && <WaitSection {...section} />}
      {step.type === 'DOCUMENT' && <DocumentSection {...section} workflowId={workflowId} />}
      {step.type === 'EXPORT' && <ExportSection {...section} />}
      {step.type === 'CALCULATOR' && <CalculatorSection {...section} />}

      {(step.type === 'START' || isPeopleStep(step.type)) &&
        (isNewRef(step.id) ? (
          !readOnly && (
            <Section title={t('builder.fields.title')}>
              <p className={styles.note}>{t('builder.fields.saveFirst')}</p>
              <div>
                <Button disabled={saving} onClick={onSave}>
                  {saving ? t('builder.saving') : t('builder.save')}
                </Button>
              </div>
            </Section>
          )
        ) : (
          <>
            <ParticipantsSection step={step} readOnly={readOnly || saving} content={content} />
            <FieldsSection step={step} doc={doc} readOnly={readOnly || saving} content={content} />
          </>
        ))}

      {step.type !== 'END' && (
        <Section title={t('builder.inspector.exits')}>
          {exits.length === 0 ? (
            <p className={styles.note}>{t('builder.inspector.noExits')}</p>
          ) : (
            <ul className={styles.exits}>
              {exits.map((exit) => (
                <li key={exit.id}>
                  <button type="button" className={styles.linkButton} onClick={() => onSelect({ kind: 'transition', id: exit.id })}>
                    {t('builder.inspector.exitTo', { label: exit.label, to: nameOf(exit.toStepId) })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className={styles.addExit}>
              <Select
                label={t('builder.inspector.addExit')}
                placeholder={t('builder.inspector.addExitPlaceholder')}
                options={doc.steps.filter((candidate) => candidate.type !== 'START').map((candidate) => ({ value: candidate.id, label: candidate.name }))}
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              />
              <Button
                disabled={target === ''}
                onClick={() => {
                  onConnect(target);
                  setTarget('');
                }}
              >
                {t('builder.inspector.connect')}
              </Button>
            </div>
          )}
        </Section>
      )}

      {!readOnly &&
        (confirming ? (
          <div className={styles.confirm}>
            {fieldsHere > 0 && <Alert tone="warn">{t('builder.inspector.removeHasFields', { count: fieldsHere })}</Alert>}
            <div className={styles.confirmActions}>
              <Button onClick={() => setConfirming(false)}>{t('cancel')}</Button>
              <Button variant="brand" onClick={onRemove}>
                {t('builder.inspector.remove')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)}>
            {t('builder.inspector.remove')}
          </Button>
        ))}
    </div>
  );
}
