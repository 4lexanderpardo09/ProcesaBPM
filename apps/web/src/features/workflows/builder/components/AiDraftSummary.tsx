import { type AiDraftResult, DRAFT_DECISION_TOPICS } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { AiDraftLosses } from './AiDraftLosses';
import styles from './Builder.module.css';

type Decision = AiDraftResult['decisions'][number];

/** The decisions in the order of the topics, so related ones read together. */
function byTopic(decisions: readonly Decision[]): Array<[Decision['topic'], Decision[]]> {
  return DRAFT_DECISION_TOPICS.map((topic) => [topic, decisions.filter((decision) => decision.topic === topic)] as [Decision['topic'], Decision[]]).filter(([, group]) => group.length > 0);
}

/**
 * What the assistant built and why, for the person to check before publishing: what the draft holds (counted by the
 * platform), the choices the model made by topic, what it assumed, and how much the review corrected. A change also
 * says which settings made in the builder (that the AI does not see) it kept, and which it lost: those always show.
 * `expanded`: the latest draft opens its lists; older ones stay folded. A `revision` lists what it changed.
 */
export function AiDraftSummary({ result, expanded, revision }: { readonly result: AiDraftResult; readonly expanded: boolean; readonly revision: boolean }) {
  const { t } = useTranslation('workflows');
  const { outline, decisions, assumptions, corrections, keptSettings, droppedSettings } = result;
  return (
    <>
      {outline !== null && (
        <p className={styles.aiText}>
          {[
            t('builder.ai.summary.steps', { count: outline.steps }),
            t('builder.ai.summary.approvals', { count: outline.approvals }),
            t('builder.ai.summary.fields', { count: outline.fields }),
            ...(outline.amountRules > 0 ? [t('builder.ai.summary.amountRules', { count: outline.amountRules })] : []),
            ...(outline.initiators > 0 ? [t('builder.ai.summary.initiators', { count: outline.initiators })] : []),
          ].join(' · ')}
        </p>
      )}
      {corrections > 0 && <p className={styles.aiMeta}>{t('builder.ai.summary.corrections', { count: corrections })}</p>}
      {decisions.length > 0 && (
        <details className={styles.aiDetails} open={expanded}>
          <summary>{revision ? t('builder.ai.summary.changes', { count: decisions.length }) : t('builder.ai.summary.decisions', { count: decisions.length })}</summary>
          <dl className={styles.aiDecisions}>
            {byTopic(decisions).map(([topic, group]) => (
              <div key={topic}>
                <dt>{t(`builder.ai.summary.topics.${topic}`)}</dt>
                {group.map((decision) => (
                  <dd key={decision.text}>{decision.text}</dd>
                ))}
              </div>
            ))}
          </dl>
        </details>
      )}
      {assumptions.length > 0 && (
        <details className={styles.aiDetails} open={expanded}>
          <summary>{revision ? t('builder.ai.summary.revisionAssumptions', { count: assumptions.length }) : t('builder.ai.summary.assumptions', { count: assumptions.length })}</summary>
          <ul className={styles.aiList}>
            {assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </details>
      )}
      {droppedSettings.length > 0 && (
        <details className={styles.aiDetails} open>
          <summary>{t('builder.ai.summary.droppedSettings', { count: droppedSettings.length })}</summary>
          <AiDraftLosses losses={droppedSettings} />
        </details>
      )}
      {keptSettings.length > 0 && (
        <details className={styles.aiDetails} open={expanded}>
          <summary>{t('builder.ai.summary.keptSettings', { count: keptSettings.length })}</summary>
          <AiDraftLosses losses={keptSettings} />
        </details>
      )}
    </>
  );
}
