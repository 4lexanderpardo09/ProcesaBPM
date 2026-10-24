import type { TransitionPreviewResponse } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Alert } from '@/shared/ui';
import styles from './NextStepSummary.module.css';

/** How many names are written out before "and N more". */
const NAMES_SHOWN = 5;
const KNOWN_BLOCKS: ReadonlySet<string> = new Set(['NO_ASSIGNEE_CANDIDATES', 'NO_MATCHING_BRANCH', 'MAX_LOOPS_REACHED', 'APPROVER_NOT_FOUND', 'INVALID_CALENDAR', 'EXPORT_CUTOFF_PENDING']);

export interface NextStepSummaryProps {
  readonly preview: TransitionPreviewResponse | undefined;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly timeZone?: string | undefined;
}

/**
 * What happens with the answer before it is sent, like the help desk's decision window: the step the ticket goes to
 * and the blocks on the way, who gets it (one person, a group that may take it, parallel signers, a hand-out in turns,
 * or a person to choose below), what is filled there and whether it is signed; the end; a wait; or why it cannot go on.
 */
export function NextStepSummary({ preview, loading, failed, timeZone }: NextStepSummaryProps) {
  const { t } = useTranslation('tickets');
  if (preview === undefined) {
    if (failed) return <p className={styles.note}>{t('nextStep.failed')}</p>;
    return loading ? <p className={styles.note}>{t('nextStep.loading')}</p> : null;
  }
  if (preview.outcome === 'BLOCKED') {
    const code = preview.blocked?.code ?? '';
    return (
      <Alert tone="warn" title={t('nextStep.blocked.title')}>
        {t(`nextStep.blocked.${KNOWN_BLOCKS.has(code) ? (code as 'NO_ASSIGNEE_CANDIDATES') : 'other'}`)}
      </Alert>
    );
  }
  const names = (people: TransitionPreviewResponse['people']) => {
    const shown = people.slice(0, NAMES_SHOWN).map((person) => person.name).join(', ');
    return people.length > NAMES_SHOWN ? t('nextStep.more', { names: shown, count: people.length - NAMES_SHOWN }) : shown;
  };
  const lines: string[] = [];
  if (preview.via.length > 0) lines.push(t('nextStep.via', { blocks: preview.via.map((block) => block.name).join(', ') }));
  if (preview.outcome === 'END') lines.push(t('nextStep.end'));
  if (preview.outcome === 'WAIT' && preview.step !== null && preview.resumeAt !== null) lines.push(t('nextStep.wait', { step: preview.step.name, date: formatDateTime(preview.resumeAt, timeZone) }));
  if (preview.outcome === 'STEP' && preview.step !== null) {
    lines.push(t('nextStep.step', { step: preview.step.name }));
    if (preview.assignment !== null) lines.push(t(`nextStep.assignment.${preview.assignment}`, { names: names(preview.people), count: preview.people.length }));
    if (preview.fields.length > 0) lines.push(t('nextStep.fields', { fields: preview.fields.join(', ') }));
    if (preview.step.type === 'SIGNATURE') lines.push(t('nextStep.signature'));
  }
  return (
    <section className={styles.box} aria-label={t('nextStep.title')} aria-busy={loading}>
      <h3 className={styles.title}>{t('nextStep.title')}</h3>
      {lines.map((line) => (
        <p key={line} className={styles.line}>
          {line}
        </p>
      ))}
    </section>
  );
}
