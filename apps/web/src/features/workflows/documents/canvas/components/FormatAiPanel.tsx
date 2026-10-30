import { AI_DESCRIPTION_LIMITS, AI_JOB_CANCELLED, AI_REVISION_LIMITS, type AiDraftMode, type AiFormatJob, type AiFormatResult, type PdfCanvasDesign } from '@procesabpm/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { formatDateTime, formatShortDateTime } from '@/shared/lib/format-date-time';
import { Alert, Button } from '@/shared/ui';
import { isOpen } from '../../../builder/api/ai-draft-api';
import { AiProgressSteps, ProgressText, useElapsedSeconds } from '../../../builder/components/AiAssistantPanel';
import builder from '../../../builder/components/Builder.module.css';
import type { FormatAi } from '../../lib/use-format-ai';
import styles from './FormatAiPanel.module.css';

/** Request errors explained in the panel (the builder's wording); anything else gets the generic message. */
const REQUEST_ERRORS = ['AI_DAILY_LIMIT_REACHED', 'AI_JOB_IN_PROGRESS', 'AI_ASSISTANT_DISABLED', 'RATE_LIMITED'] as const;
type RequestErrorCode = (typeof REQUEST_ERRORS)[number];
const isRequestError = (code: string): code is RequestErrorCode => (REQUEST_ERRORS as readonly string[]).includes(code);
/** Why a format request ended without a design: its own wording first, then the builder's for what both share. */
const FORMAT_ERRORS = ['AI_DRAFT_INVALID', 'FORMAT_GONE', 'AI_JOB_INVALID'] as const;
const SHARED_ERRORS = ['AI_PROVIDER_FAILED', 'AI_NOT_CONFIGURED', 'AI_DISABLED', 'LEASE_EXPIRED', 'QUEUE_EXPIRED'] as const;

export interface FormatAiPanelProps {
  readonly ai: FormatAi;
  /** The design on screen (saved or not): what a change starts from. */
  readonly design: PdfCanvasDesign;
  readonly onApply: (result: AiFormatResult) => void;
  readonly onClose: () => void;
}

/**
 * Jiro beside the format designer: the requests of this format read like a conversation, the one in progress moves
 * live, and the next message is written at the bottom. A finished design is put on the canvas as an unsaved change
 * (the person reviews, adjusts and saves it); an earlier one can be put back. Closing it stops nothing.
 */
export function FormatAiPanel({ ai, design, onApply, onClose }: FormatAiPanelProps) {
  const { t } = useTranslation('workflows');
  const end = useRef<HTMLLIElement>(null);
  const lastId = ai.jobs.at(-1)?.id;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [lastId]);

  return (
    <div className={styles.dock}>
      <section className={builder.aiPanel} aria-label={t('documents.jiro.history')}>
        <header className={builder.panelHeader}>
          <div className={builder.aiBrand}>
            <span className={builder.aiAvatar} aria-hidden="true">J</span>
            <div className={builder.aiBrandText}>
              <h2 className={builder.aiName}>{t('builder.ai.name')}</h2>
              <span className={builder.aiTagline}>{t('documents.jiro.tagline')}</span>
            </div>
          </div>
          <button type="button" className={builder.panelClose} aria-label={t('documents.jiro.close')} onClick={onClose}>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div className={builder.aiConversation}>
          {ai.jobs.length === 0 ? (
            ai.loading ? (
              <p className={builder.note}>{t('builder.ai.loading')}</p>
            ) : (
              <div className={builder.aiEmpty}>
                <span className={builder.aiEmptyAvatar} aria-hidden="true">J</span>
                <p className={builder.aiGreeting}>{t('documents.jiro.greeting')}</p>
                <p className={builder.note}>{t('documents.jiro.intro')}</p>
              </div>
            )
          ) : (
            <ol className={builder.aiHistory} aria-label={t('documents.jiro.history')}>
              {ai.jobs.map((job) => (
                <FormatTurn key={job.id} job={job} ai={ai} onApply={onApply} />
              ))}
              <li ref={end} aria-hidden="true" />
            </ol>
          )}
        </div>
        <p className={builder.visuallyHidden} role="status" aria-live="polite">
          {ai.active === undefined ? '' : <ProgressText job={ai.active} subject="format" />}
        </p>
        <FormatComposer ai={ai} design={design} />
      </section>
    </div>
  );
}

function FormatTurn({ job, ai, onApply }: { readonly job: AiFormatJob; readonly ai: FormatAi; readonly onApply: (result: AiFormatResult) => void }) {
  const { t } = useTranslation('workflows');
  const open = isOpen(job.status);
  return (
    <li className={builder.aiTurn}>
      <div className={builder.aiAsked}>
        <p className={builder.aiMeta}>
          <span className={builder.aiKind}>{t(`builder.ai.kinds.${job.kind}`)}</span> · {t('builder.ai.askedBy', { name: job.requesterName, at: formatShortDateTime(job.createdAt) })}
        </p>
        <p className={builder.aiText}>{job.description ?? t('builder.ai.descriptionGone')}</p>
      </div>
      <div className={open ? builder.aiAnswerOpen : job.status === 'SUCCEEDED' ? builder.aiAnswerOk : builder.aiAnswerFailed}>
        {open ? <FormatProgress job={job} cancelling={ai.cancel.isPending} onCancel={() => ai.cancel.mutate(job.id)} /> : <FormatOutcome job={job} onApply={onApply} />}
        {job.tokens > 0 && <p className={builder.aiMeta}>{t('builder.ai.tokens', { count: job.tokens, formatted: job.tokens.toLocaleString('es-CO') })}</p>}
      </div>
    </li>
  );
}

function FormatProgress({ job, cancelling, onCancel }: { readonly job: AiFormatJob; readonly cancelling: boolean; readonly onCancel: () => void }) {
  const { t } = useTranslation('workflows');
  const elapsed = useElapsedSeconds(job.startedAt ?? job.createdAt);
  return (
    <>
      <AiProgressSteps job={job} subject="format" />
      <p className={builder.aiMeta}>{t('builder.ai.elapsed', { seconds: elapsed })}</p>
      <div>
        <Button variant="ghost" disabled={cancelling} onClick={onCancel}>
          {cancelling ? t('builder.ai.cancelling') : t('builder.ai.cancel')}
        </Button>
      </div>
    </>
  );
}

function FormatOutcome({ job, onApply }: { readonly job: AiFormatJob; readonly onApply: (result: AiFormatResult) => void }) {
  const { t } = useTranslation('workflows');
  if (job.status === 'SUCCEEDED' && job.result !== null) {
    const result = job.result;
    return (
      <>
        <p className={builder.strong}>{t('documents.jiro.ready')}</p>
        {result.errors > 0 && <p className={builder.aiText}>{t('documents.jiro.readyLeft', { count: result.errors })}</p>}
        {result.decisions.length > 0 && (
          <>
            <p className={builder.aiMeta}>{t('documents.jiro.decisions')}</p>
            <ul className={styles.list}>
              {result.decisions.map((decision) => (
                <li key={decision.text} className={builder.aiText}>
                  {decision.text}
                </li>
              ))}
            </ul>
          </>
        )}
        {result.assumptions.length > 0 && (
          <>
            <p className={builder.aiMeta}>{t('documents.jiro.assumptions')}</p>
            <ul className={styles.list}>
              {result.assumptions.map((assumption) => (
                <li key={assumption} className={builder.aiText}>
                  {assumption}
                </li>
              ))}
            </ul>
          </>
        )}
        <div>
          <Button variant="ghost" onClick={() => onApply(result)}>
            {t('documents.jiro.apply')}
          </Button>
        </div>
      </>
    );
  }
  if (job.errorCode === AI_JOB_CANCELLED) {
    return <p className={builder.strong}>{job.cancelledByName === null ? t('builder.ai.cancelled') : t('builder.ai.cancelledBy', { name: job.cancelledByName })}</p>;
  }
  return <p className={builder.strong}>{failureText(job.errorCode, t)}</p>;
}

function failureText(code: string | null, t: ReturnType<typeof useTranslation<'workflows'>>['t']): string {
  if ((FORMAT_ERRORS as readonly (string | null)[]).includes(code)) return t(`documents.jiro.jobErrors.${code as (typeof FORMAT_ERRORS)[number]}`);
  if ((SHARED_ERRORS as readonly (string | null)[]).includes(code)) return t(`builder.ai.jobErrors.${code as (typeof SHARED_ERRORS)[number]}`);
  return t('documents.jiro.jobErrors.UNKNOWN');
}

/** The message at the bottom: a change to the format on screen by default when it has elements, or a new format. */
function FormatComposer({ ai, design }: { readonly ai: FormatAi; readonly design: PdfCanvasDesign }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  const hasContent = design.elements.length > 0;
  const [message, setMessage] = useState('');
  const [startOver, setStartOver] = useState(false);
  const mode: AiDraftMode = hasContent && !startOver ? 'REVISE' : 'CREATE';
  const limits = mode === 'REVISE' ? AI_REVISION_LIMITS : AI_DESCRIPTION_LIMITS;
  const length = message.trim().length;
  const blocked = ai.active !== undefined || ai.remainingToday === 0;
  const canSend = !blocked && !ai.request.isPending && length >= limits.min && length <= limits.max;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    ai.request.mutate(mode === 'REVISE' ? { mode, description: message.trim(), design } : { mode, description: message.trim() }, { onSuccess: () => setMessage('') });
  };

  const error = ai.request.error;
  const generic = error === null || (error instanceof ApiError && isRequestError(error.code)) ? undefined : genericErrorMessage(error);
  const resetsAt = error instanceof ApiError ? (error.details as { resetsAt?: string } | undefined)?.resetsAt : undefined;

  return (
    <form className={builder.aiComposer} onSubmit={submit}>
      {error instanceof ApiError && isRequestError(error.code) && <Alert tone="danger">{t(`builder.ai.requestErrors.${error.code}`, { resetsAt: resetsAt === undefined ? '' : formatDateTime(resetsAt) })}</Alert>}
      {generic !== undefined && <Alert tone="danger">{'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key)}</Alert>}
      {ai.cancel.error !== null && <Alert tone="danger">{t('builder.ai.cancelFailed')}</Alert>}
      {mode === 'CREATE' && hasContent && ai.active === undefined && <Alert tone="warn">{t('documents.jiro.replaces')}</Alert>}
      <div className={builder.aiComposerBox}>
        <textarea
          className={builder.aiComposerInput}
          aria-label={mode === 'REVISE' ? t('documents.jiro.reviseLabel') : t('documents.jiro.label')}
          rows={mode === 'REVISE' ? 3 : 4}
          maxLength={limits.max}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={mode === 'REVISE' ? t('documents.jiro.revisePlaceholder') : t('documents.jiro.placeholder')}
        />
        <div className={builder.aiComposerBar}>
          <span className={builder.aiComposerCount}>
            {length} / {limits.max}
          </span>
          <Button variant="primary" type="submit" disabled={!canSend}>
            {ai.request.isPending ? t('builder.ai.sending') : mode === 'REVISE' ? t('documents.jiro.reviseSubmit') : t('documents.jiro.submit')}
          </Button>
        </div>
      </div>
      <details className={builder.aiDetails}>
        <summary>{t('builder.ai.moreInfo')}</summary>
        <p className={builder.aiMeta}>{t('documents.jiro.privacy')}</p>
      </details>
      <div className={builder.aiComposerFoot}>
        <span className={builder.aiMeta}>{ai.remainingToday === 0 ? t('builder.ai.noneLeft') : t('builder.ai.remaining', { count: ai.remainingToday })}</span>
        {hasContent && (
          <Button variant="ghost" aria-pressed={startOver} onClick={() => setStartOver((current) => !current)}>
            {startOver ? t('builder.ai.revise.backToChanges') : t('builder.ai.revise.startOver')}
          </Button>
        )}
      </div>
    </form>
  );
}
