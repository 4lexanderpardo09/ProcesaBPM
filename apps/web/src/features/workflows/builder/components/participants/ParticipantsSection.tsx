import type { AssignmentMode, StepDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { WorkflowError } from '../../../components/WorkflowError';
import type { DraftContent } from '../../hooks/use-draft-content';
import type { RecordKind } from '../../hooks/use-record-names';
import { setStepChildren } from '../../lib/content-doc';
import { fromCandidates, fromInitiators, toCandidates, toInitiators } from '../../lib/participants';
import { isPeopleStep } from '../../lib/block-catalog';
import { Section } from '../StepSections';
import { ParticipantList } from './ParticipantList';
import { SignersEditor } from './SignersEditor';
import { SlaOverridesEditor } from './SlaOverridesEditor';
import { StepFilesEditor } from './StepFilesEditor';
import styles from '../Builder.module.css';

/** Who can be picked to take the step, by mode (a position mode uses the position chosen above). */
const CANDIDATE_KINDS: Readonly<Partial<Record<AssignmentMode, readonly RecordKind[]>>> = {
  USERS: ['USER'],
  GROUP: ['GROUP'],
  POOL: ['USER', 'POSITION', 'GROUP'],
  RANDOM_DISPATCH: ['USER', 'POSITION', 'GROUP'],
};
const INITIATOR_KINDS: readonly RecordKind[] = ['USER', 'POSITION', 'GROUP', 'DEPARTMENT', 'COMPANY', 'SITE'];

export interface ParticipantsSectionProps {
  readonly step: StepDocument;
  readonly readOnly: boolean;
  readonly content: DraftContent;
}

/** The lists of a block, each replaced whole through the API: candidates, initiators, signers, deadlines per company and files. */
export function ParticipantsSection({ step, readOnly, content }: ParticipantsSectionProps) {
  const { t } = useTranslation('workflows');
  const apply = (doc: Parameters<typeof setStepChildren>[0], children: Parameters<typeof setStepChildren>[2]) => setStepChildren(doc, step.id, children);
  const candidateKinds = CANDIDATE_KINDS[step.assignmentMode];
  const signs = step.type === 'SIGNATURE' || step.assignmentMode === 'PARALLEL';
  const people = isPeopleStep(step.type);
  if (step.type !== 'START' && !people) return null;
  return (
    <>
      <WorkflowError error={content.error} context="content" />
      {step.type === 'START' && (
        <Section title={t('builder.participants.initiators')}>
          <p className={styles.note}>{t('builder.participants.initiatorsHint')}</p>
          <ParticipantList
            label={t('builder.participants.initiators')}
            empty={t('builder.participants.initiatorsEmpty')}
            kinds={INITIATOR_KINDS}
            items={fromInitiators(step.initiators)}
            readOnly={readOnly}
            pending={content.pending}
            onChange={(items) => void content.run({ call: (api) => api.replaceInitiators(step.id, toInitiators(items)), apply })}
          />
        </Section>
      )}
      {candidateKinds !== undefined && (
        <Section title={t('builder.participants.candidates')}>
          <p className={styles.note}>{t('builder.participants.candidatesHint')}</p>
          <ParticipantList
            label={t('builder.participants.candidates')}
            empty={t('builder.participants.candidatesEmpty')}
            kinds={candidateKinds}
            items={fromCandidates(step.candidates)}
            readOnly={readOnly}
            pending={content.pending}
            onChange={(items) => void content.run({ call: (api) => api.replaceCandidates(step.id, toCandidates(items)), apply })}
          />
        </Section>
      )}
      {signs && (
        <Section title={t('builder.participants.signers')}>
          <p className={styles.note}>{t('builder.participants.signersHint')}</p>
          <SignersEditor
            signers={step.signers}
            parallel={step.assignmentMode === 'PARALLEL'}
            readOnly={readOnly}
            pending={content.pending}
            onChange={(signers) => void content.run({ call: (api) => api.replaceSigners(step.id, { signers }), apply })}
          />
        </Section>
      )}
      {people && (
        <>
          <Section title={t('builder.participants.sla')}>
            <p className={styles.note}>{t('builder.participants.slaHint')}</p>
            <SlaOverridesEditor overrides={step.slaOverrides} readOnly={readOnly} pending={content.pending} onChange={(overrides) => void content.run({ call: (api) => api.replaceSlaOverrides(step.id, { overrides }), apply })} />
          </Section>
          <Section title={t('builder.participants.files')}>
            <p className={styles.note}>{t('builder.participants.filesHint')}</p>
            <StepFilesEditor files={step.files} readOnly={readOnly} pending={content.pending} onChange={(files) => void content.run({ call: (api) => api.replaceFiles(step.id, { files }), apply })} />
          </Section>
        </>
      )}
    </>
  );
}
