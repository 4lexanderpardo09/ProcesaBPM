import { AI_DESCRIPTION_LIMITS, AI_JOB_CANCELLED, AI_JOB_STAGES, AI_REVISION_LIMITS, type AiDraftMode, aiDraftNotRevisableDetailsSchema, type AiJobHistoryItem } from '@procesabpm/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { formatDateTime, formatShortDateTime } from '@/shared/lib/format-date-time';
import { Alert, Button, TextArea } from '@/shared/ui';
import { isOpen } from '../api/ai-draft-api';
import type { AiDraft } from '../hooks/use-ai-draft';
import { AiDraftLosses } from './AiDraftLosses';
import { AiDraftSummary } from './AiDraftSummary';
import styles from './Builder.module.css';

/** Request errors the panel explains; anything else gets the generic message. */
const REQUEST_ERRORS = ['AI_DAILY_LIMIT_REACHED', 'AI_JOB_IN_PROGRESS', 'STALE_REVISION', 'AI_ASSISTANT_DISABLED', 'RATE_LIMITED', 'AI_DRAFT_NOT_REVISABLE'] as const;
type RequestErrorCode = (typeof REQUEST_ERRORS)[number];
const isRequestError = (code: string): code is RequestErrorCode => (REQUEST_ERRORS as readonly string[]).includes(code);
/** Why a request ended without a draft (`ai_jobs.error_code`). */
const JOB_ERRORS = ['AI_DRAFT_INVALID', 'AI_PROVIDER_FAILED', 'AI_NOT_CONFIGURED', 'DRAFT_CHANGED', 'DRAFT_GONE', 'AI_DISABLED', 'DRAFT_WRITE_FAILED', 'LEASE_EXPIRED', 'QUEUE_EXPIRED', 'AI_DRAFT_NOT_REVISABLE'] as const;
type JobErrorCode = (typeof JOB_ERRORS)[number] | 'UNKNOWN';
const jobErrorOf = (code: string | null): JobErrorCode => ((JOB_ERRORS as readonly string[]).includes(code ?? '') ? (code as JobErrorCode) : 'UNKNOWN');

function useElapsedSeconds(since: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.round((now - new Date(since).getTime()) / 1_000));
}

export interface AiAssistantPanelProps {
  readonly ai: AiDraft;
  readonly revision: number;
  readonly hasContent: boolean;
  /** Unsaved changes: the AI would replace them, so nothing is sent until they are saved. */
  readonly dirty: boolean;
  readonly onClose: () => void;
}

/**
 * «Crear con IA» as a panel docked beside the canvas: the requests of this draft read like a conversation (what was
 * asked, by whom, and how it went), the one in progress moves live, and the next message is written at the bottom: a
 * change to the draft when it has content, or the description of a new one.
 * Closing it hides nothing: the request goes on, and the panel shows it again when reopened or after a reload.
 */
export function AiAssistantPanel({ ai, revision, hasContent, dirty, onClose }: AiAssistantPanelProps) {
  const { t } = useTranslation('workflows');
  const end = useRef<HTMLLIElement>(null);
  const lastId = ai.jobs.at(-1)?.id;
  // A block body: browsers that make scrolling return a promise would hand it to React as the effect's cleanup.
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [lastId]);

  return (
    <section className={styles.aiPanel} aria-label={t('builder.ai.title')}>
      <header className={styles.panelHeader}>
        <div className={styles.aiBrand}>
          <span className={styles.aiAvatar} aria-hidden="true">J</span>
          <span className={styles.aiBrandText}>
            <h2 className={styles.aiName}>{t('builder.ai.name')}</h2>
            <span className={styles.aiTagline}>{t('builder.ai.tagline')}</span>
          </span>
        </div>
        <button type="button" className={styles.panelClose} aria-label={t('builder.ai.close')} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className={styles.aiConversation}>
        {ai.jobs.length === 0 ? (
          ai.loading ? (
            <p className={styles.note}>{t('builder.ai.loading')}</p>
          ) : (
            <div className={styles.aiEmpty}>
              <span className={styles.aiEmptyAvatar} aria-hidden="true">J</span>
              <p className={styles.aiGreeting}>{t('builder.ai.greeting')}</p>
              <p className={styles.note}>{t('builder.ai.intro')}</p>
            </div>
          )
        ) : (
          <ol className={styles.aiHistory} aria-label={t('builder.ai.history')}>
            {ai.jobs.map((job) => (
              <AiRequest key={job.id} job={job} ai={ai} latest={job.id === lastId} />
            ))}
            <li ref={end} aria-hidden="true" />
          </ol>
        )}
      </div>
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {ai.active === undefined ? '' : <ProgressText job={ai.active} />}
      </p>
      <AiComposer ai={ai} revision={revision} hasContent={hasContent} dirty={dirty} />
    </section>
  );
}

/** One request: the person's description, then the assistant's progress or outcome. */
function AiRequest({ job, ai, latest }: { readonly job: AiJobHistoryItem; readonly ai: AiDraft; readonly latest: boolean }) {
  const { t } = useTranslation('workflows');
  const open = isOpen(job.status);
  return (
    <li className={styles.aiTurn}>
      <div className={styles.aiAsked}>
        <p className={styles.aiMeta}>
          <span className={styles.aiKind}>{t(`builder.ai.kinds.${job.kind}`)}</span> · {t('builder.ai.askedBy', { name: job.requesterName, at: formatShortDateTime(job.createdAt) })}
        </p>
        <p className={styles.aiText}>{job.description ?? t('builder.ai.descriptionGone')}</p>
      </div>
      <div className={open ? styles.aiAnswerOpen : job.status === 'SUCCEEDED' ? styles.aiAnswerOk : styles.aiAnswerFailed}>
        {open ? <Progress job={job} cancelling={ai.cancel.isPending} onCancel={() => ai.cancel.mutate(job.id)} /> : <Outcome job={job} latest={latest} />}
        {job.tokens > 0 && <p className={styles.aiMeta}>{t('builder.ai.tokens', { count: job.tokens, formatted: job.tokens.toLocaleString('es-CO') })}</p>}
      </div>
    </li>
  );
}

function ProgressText({ job }: { readonly job: AiJobHistoryItem }) {
  const { t } = useTranslation('workflows');
  if (job.status === 'PENDING') return <>{t('builder.ai.stages.PENDING')}</>;
  switch (job.stage) {
    case 'DESIGNING':
      return <>{t('builder.ai.stages.DESIGNING', { round: job.round ?? 1 })}</>;
    case 'REVIEWING':
      return <>{t('builder.ai.stages.REVIEWING', { round: job.round ?? 1, count: job.problems ?? 0 })}</>;
    case 'WRITING':
      return <>{t('builder.ai.stages.WRITING')}</>;
    default:
      return <>{t('builder.ai.stages.READING')}</>;
  }
}

/** The run's four stages as a live stepper: those done, the one in progress with its detail, and what is left. */
function AiProgressSteps({ job }: { readonly job: AiJobHistoryItem }) {
  const { t } = useTranslation('workflows');
  if (job.status === 'PENDING') {
    return (
      <div className={styles.aiSteps}>
        <div className={`${styles.aiStep} ${styles.aiStepNow}`}>
          <span className={styles.aiStepMark} aria-hidden="true" />
          <span className={styles.aiStepBody}>
            <span className={styles.aiStepLabel}>
              {t('builder.ai.stages.PENDING')}
              <span className={styles.aiLiveDot} aria-hidden="true" />
            </span>
          </span>
        </div>
      </div>
    );
  }
  const current = Math.max(0, AI_JOB_STAGES.indexOf(job.stage ?? 'READING'));
  return (
    <div className={styles.aiSteps}>
      {AI_JOB_STAGES.map((stage, index) => {
        const state = index > current ? 'todo' : index < current ? 'done' : 'now';
        return (
          <div key={stage} className={`${styles.aiStep} ${state === 'done' ? styles.aiStepDone : state === 'now' ? styles.aiStepNow : styles.aiStepTodo}`}>
            <span className={styles.aiStepMark} aria-hidden="true" />
            <span className={styles.aiStepBody}>
              <span className={styles.aiStepLabel}>
                {t(`builder.ai.stageLabels.${stage}`)}
                {state === 'now' && <span className={styles.aiLiveDot} aria-hidden="true" />}
              </span>
              {state === 'now' && (
                <span className={styles.aiStepDesc}>
                  <ProgressText job={job} />
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Progress({ job, cancelling, onCancel }: { readonly job: AiJobHistoryItem; readonly cancelling: boolean; readonly onCancel: () => void }) {
  const { t } = useTranslation('workflows');
  const elapsed = useElapsedSeconds(job.startedAt ?? job.createdAt);
  return (
    <>
      <AiProgressSteps job={job} />
      <p className={styles.aiMeta}>{t('builder.ai.elapsed', { seconds: elapsed })}</p>
      {job.stage === 'DESIGNING' && job.preview !== null && job.preview.steps.length > 0 && <p className={styles.aiMeta}>{t('builder.ai.preview.onCanvas')}</p>}
      <div>
        <Button variant="ghost" disabled={cancelling} onClick={onCancel}>
          {cancelling ? t('builder.ai.cancelling') : t('builder.ai.cancel')}
        </Button>
      </div>
    </>
  );
}

function Outcome({ job, latest }: { readonly job: AiJobHistoryItem; readonly latest: boolean }) {
  const { t } = useTranslation('workflows');
  if (job.status === 'SUCCEEDED' && job.result !== null) {
    const { rounds, errors, warnings } = job.result;
    const revision = job.kind === 'WORKFLOW_DRAFT_REVISION';
    return (
      <>
        <p className={styles.strong}>{revision ? t('builder.ai.revised', { count: rounds }) : t('builder.ai.succeeded', { count: rounds })}</p>
        <AiDraftSummary result={job.result} expanded={latest} revision={revision} />
        {errors > 0 && <p className={styles.aiText}>{t('builder.ai.leftErrors', { count: errors })}</p>}
        {errors === 0 && warnings > 0 && <p className={styles.aiText}>{t('builder.ai.leftWarnings', { count: warnings })}</p>}
      </>
    );
  }
  if (job.errorCode === AI_JOB_CANCELLED) {
    return <p className={styles.strong}>{job.cancelledByName === null ? t('builder.ai.cancelled') : t('builder.ai.cancelledBy', { name: job.cancelledByName })}</p>;
  }
  return <p className={styles.strong}>{t(`builder.ai.jobErrors.${jobErrorOf(job.errorCode)}`)}</p>;
}

/**
 * The message at the bottom, like a chat: a draft with content is changed by default (the AI keeps the rest), and
 * «Empezar de cero» asks for a new one instead, which replaces it. Sending is held while the draft has unsaved changes
 * or a request runs.
 */
function AiComposer({ ai, revision, hasContent, dirty }: { readonly ai: AiDraft; readonly revision: number; readonly hasContent: boolean; readonly dirty: boolean }) {
  const { t } = useTranslation('workflows');
  const [message, setMessage] = useState('');
  const [startOver, setStartOver] = useState(false);
  const mode: AiDraftMode = hasContent && !startOver ? 'REVISE' : 'CREATE';
  const limits = mode === 'REVISE' ? AI_REVISION_LIMITS : AI_DESCRIPTION_LIMITS;
  const length = message.trim().length;
  const blocked = dirty || ai.active !== undefined || ai.remainingToday === 0;
  const canSend = !blocked && !ai.request.isPending && length >= limits.min && length <= limits.max;
  const cancelError = ai.cancel.error === null ? undefined : t('builder.ai.cancelFailed');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    ai.request.mutate({ mode, description: message.trim(), revision }, { onSuccess: () => setMessage('') });
  };

  return (
    <form className={styles.aiComposer} onSubmit={submit}>
      <RequestError error={ai.request.error} />
      {cancelError !== undefined && <Alert tone="danger">{cancelError}</Alert>}
      {dirty && <Alert tone="warn">{t('builder.ai.saveFirst')}</Alert>}
      {!dirty && mode === 'CREATE' && hasContent && ai.active === undefined && <Alert tone="warn">{t('builder.ai.replaces')}</Alert>}
      <TextArea
        label={mode === 'REVISE' ? t('builder.ai.revise.label') : t('builder.ai.description')}
        hint={mode === 'REVISE' ? t('builder.ai.revise.hint', { count: length, max: limits.max }) : t('builder.ai.descriptionHint', { count: length, max: limits.max })}
        rows={mode === 'REVISE' ? 3 : 4}
        maxLength={limits.max}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={mode === 'REVISE' ? t('builder.ai.revise.placeholder') : t('builder.ai.placeholder')}
      />
      <details className={styles.aiDetails}>
        <summary>{t('builder.ai.moreInfo')}</summary>
        <p className={styles.aiMeta}>{t('builder.ai.privacy')}</p>
        {mode === 'REVISE' && <p className={styles.aiMeta}>{t('builder.ai.revise.keeps')}</p>}
      </details>
      <div className={styles.aiComposerActions}>
        <span className={styles.aiMeta}>{ai.remainingToday === 0 ? t('builder.ai.noneLeft') : t('builder.ai.remaining', { count: ai.remainingToday })}</span>
        <div className={styles.aiComposerButtons}>
          {hasContent && (
            <Button variant="ghost" aria-pressed={startOver} onClick={() => setStartOver((current) => !current)}>
              {startOver ? t('builder.ai.revise.backToChanges') : t('builder.ai.revise.startOver')}
            </Button>
          )}
          <Button variant="primary" type="submit" disabled={!canSend}>
            {ai.request.isPending ? t('builder.ai.sending') : mode === 'REVISE' ? t('builder.ai.revise.submit') : t('builder.ai.submit')}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Why the last request was refused: the known codes explained (a revision that would lose something, with what), others generic. */
function RequestError({ error }: { readonly error: Error | null }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  if (error === null) return null;
  if (!(error instanceof ApiError) || !isRequestError(error.code)) {
    const generic = genericErrorMessage(error);
    return <Alert tone="danger">{'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key)}</Alert>;
  }
  const losses = error.code === 'AI_DRAFT_NOT_REVISABLE' ? aiDraftNotRevisableDetailsSchema.safeParse(error.details) : undefined;
  const resetsAt = (error.details as { resetsAt?: string } | undefined)?.resetsAt;
  return (
    <Alert tone="danger">
      {t(`builder.ai.requestErrors.${error.code}`, { resetsAt: resetsAt === undefined ? '' : formatDateTime(resetsAt) })}
      {losses?.success === true && losses.data.losses.length > 0 && <AiDraftLosses losses={losses.data.losses} />}
    </Alert>
  );
}
