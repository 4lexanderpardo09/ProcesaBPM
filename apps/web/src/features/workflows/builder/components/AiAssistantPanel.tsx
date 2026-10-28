import { AI_DESCRIPTION_LIMITS, AI_JOB_CANCELLED, type AiJobHistoryItem } from '@procesabpm/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { formatDateTime, formatShortDateTime } from '@/shared/lib/format-date-time';
import { Alert, Button, TextArea } from '@/shared/ui';
import { isOpen } from '../api/ai-draft-api';
import type { AiDraft } from '../hooks/use-ai-draft';
import { AiDraftSummary } from './AiDraftSummary';
import styles from './Builder.module.css';

/** Request errors the panel explains; anything else gets the generic message. */
const REQUEST_ERRORS = ['AI_DAILY_LIMIT_REACHED', 'AI_JOB_IN_PROGRESS', 'STALE_REVISION', 'AI_ASSISTANT_DISABLED', 'RATE_LIMITED'] as const;
type RequestErrorCode = (typeof REQUEST_ERRORS)[number];
const isRequestError = (code: string): code is RequestErrorCode => (REQUEST_ERRORS as readonly string[]).includes(code);
/** Why a request ended without a draft (`ai_jobs.error_code`). */
const JOB_ERRORS = ['AI_DRAFT_INVALID', 'AI_PROVIDER_FAILED', 'AI_NOT_CONFIGURED', 'DRAFT_CHANGED', 'DRAFT_GONE', 'AI_DISABLED', 'DRAFT_WRITE_FAILED', 'LEASE_EXPIRED', 'QUEUE_EXPIRED'] as const;
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
 * asked, by whom, and how it went), the one in progress moves live, and the description is written at the bottom.
 * Closing it hides nothing: the request goes on, and the panel shows it again when reopened or after a reload.
 */
export function AiAssistantPanel({ ai, revision, hasContent, dirty, onClose }: AiAssistantPanelProps) {
  const { t } = useTranslation('workflows');
  const end = useRef<HTMLLIElement>(null);
  const lastId = ai.jobs.at(-1)?.id;
  useEffect(() => end.current?.scrollIntoView?.({ block: 'end' }), [lastId]);

  return (
    <section className={styles.aiPanel} aria-label={t('builder.ai.title')}>
      <header className={styles.panelHeader}>
        <h2 className={styles.sectionTitle}>{t('builder.ai.title')}</h2>
        <button type="button" className={styles.panelClose} aria-label={t('builder.ai.close')} onClick={onClose}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>
      <div className={styles.aiConversation}>
        {ai.jobs.length === 0 ? (
          <p className={styles.note}>{ai.loading ? t('builder.ai.loading') : t('builder.ai.intro')}</p>
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
        <p className={styles.aiMeta}>{t('builder.ai.askedBy', { name: job.requesterName, at: formatShortDateTime(job.createdAt) })}</p>
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

function Progress({ job, cancelling, onCancel }: { readonly job: AiJobHistoryItem; readonly cancelling: boolean; readonly onCancel: () => void }) {
  const { t } = useTranslation('workflows');
  const elapsed = useElapsedSeconds(job.startedAt ?? job.createdAt);
  return (
    <>
      <p className={styles.strong}>
        <ProgressText job={job} />
      </p>
      <p className={styles.aiMeta}>{t('builder.ai.elapsed', { seconds: elapsed })}</p>
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
    return (
      <>
        <p className={styles.strong}>{t('builder.ai.succeeded', { count: rounds })}</p>
        <AiDraftSummary result={job.result} expanded={latest} />
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

/** The description at the bottom, like a chat; sending is held while the draft has unsaved changes or a request runs. */
function AiComposer({ ai, revision, hasContent, dirty }: { readonly ai: AiDraft; readonly revision: number; readonly hasContent: boolean; readonly dirty: boolean }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  const [description, setDescription] = useState('');
  const length = description.trim().length;
  const blocked = dirty || ai.active !== undefined || ai.remainingToday === 0;
  const canSend = !blocked && !ai.request.isPending && length >= AI_DESCRIPTION_LIMITS.min && length <= AI_DESCRIPTION_LIMITS.max;

  const requestError = (() => {
    const error = ai.request.error;
    if (error === null) return undefined;
    if (error instanceof ApiError && isRequestError(error.code)) {
      const resetsAt = (error.details as { resetsAt?: string } | undefined)?.resetsAt;
      return t(`builder.ai.requestErrors.${error.code}`, { resetsAt: resetsAt === undefined ? '' : formatDateTime(resetsAt) });
    }
    const generic = genericErrorMessage(error);
    return 'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key);
  })();
  const cancelError = ai.cancel.error === null ? undefined : t('builder.ai.cancelFailed');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    ai.request.mutate({ mode: 'CREATE', description: description.trim(), revision }, { onSuccess: () => setDescription('') });
  };

  return (
    <form className={styles.aiComposer} onSubmit={submit}>
      {requestError !== undefined && <Alert tone="danger">{requestError}</Alert>}
      {cancelError !== undefined && <Alert tone="danger">{cancelError}</Alert>}
      {dirty && <Alert tone="warn">{t('builder.ai.saveFirst')}</Alert>}
      {!dirty && hasContent && ai.active === undefined && <Alert tone="warn">{t('builder.ai.replaces')}</Alert>}
      <TextArea
        label={t('builder.ai.description')}
        hint={t('builder.ai.descriptionHint', { count: length, max: AI_DESCRIPTION_LIMITS.max })}
        rows={4}
        maxLength={AI_DESCRIPTION_LIMITS.max}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={t('builder.ai.placeholder')}
      />
      <p className={styles.aiMeta}>{t('builder.ai.privacy')}</p>
      <div className={styles.aiComposerActions}>
        <span className={styles.aiMeta}>{ai.remainingToday === 0 ? t('builder.ai.noneLeft') : t('builder.ai.remaining', { count: ai.remainingToday })}</span>
        <Button variant="primary" type="submit" disabled={!canSend}>
          {ai.request.isPending ? t('builder.ai.sending') : t('builder.ai.submit')}
        </Button>
      </div>
    </form>
  );
}
