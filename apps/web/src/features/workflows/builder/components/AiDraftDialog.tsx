import { AI_DESCRIPTION_LIMITS } from '@procesabpm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, genericErrorMessage } from '@/shared/api';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Alert, Button, Dialog, TextArea } from '@/shared/ui';
import type { AiDraft } from '../hooks/use-ai-draft';
import styles from './Builder.module.css';

/** Request errors the dialog explains; anything else gets the generic message. */
const REQUEST_ERRORS = ['AI_DAILY_LIMIT_REACHED', 'AI_JOB_IN_PROGRESS', 'STALE_REVISION', 'AI_ASSISTANT_DISABLED', 'RATE_LIMITED'] as const;
type RequestErrorCode = (typeof REQUEST_ERRORS)[number];
const isRequestError = (code: string): code is RequestErrorCode => (REQUEST_ERRORS as readonly string[]).includes(code);
/** Why a request ended without a draft (`ai_jobs.error_code`). */
const JOB_ERRORS = ['AI_DRAFT_INVALID', 'AI_PROVIDER_FAILED', 'AI_NOT_CONFIGURED', 'DRAFT_CHANGED', 'DRAFT_GONE', 'AI_DISABLED', 'LEASE_EXPIRED', 'QUEUE_EXPIRED'] as const;
type JobErrorCode = (typeof JOB_ERRORS)[number] | 'UNKNOWN';
const jobErrorOf = (code: string | null | undefined): JobErrorCode => ((JOB_ERRORS as readonly string[]).includes(code ?? '') ? (code as JobErrorCode) : 'UNKNOWN');

function useElapsedSeconds(since: string | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === undefined) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [since]);
  return since === undefined ? 0 : Math.max(0, Math.round((now - new Date(since).getTime()) / 1_000));
}

/**
 * «Crear con IA»: the person describes the process, the assistant builds the draft in the background. While it works
 * the dialog shows how long it has been; it can be closed and the draft still arrives.
 */
export function AiDraftDialog({ ai, revision, hasContent, onClose }: { readonly ai: AiDraft; readonly revision: number; readonly hasContent: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation('workflows');
  const { t: tCommon } = useTranslation();
  const [description, setDescription] = useState('');
  const job = ai.job;
  const working = job !== undefined && (job.status === 'PENDING' || job.status === 'RUNNING');
  const failed = job?.status === 'FAILED';
  const elapsed = useElapsedSeconds(working ? job.createdAt : undefined);
  const length = description.trim().length;
  const tooShort = length < AI_DESCRIPTION_LIMITS.min;

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

  const footer = working ? (
    <Button onClick={onClose}>{t('builder.ai.keepWorking')}</Button>
  ) : failed ? (
    <>
      <Button onClick={onClose}>{t('close')}</Button>
      <Button variant="primary" onClick={ai.reset}>
        {t('builder.ai.tryAgain')}
      </Button>
    </>
  ) : (
    <>
      <Button onClick={onClose}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" disabled={tooShort || length > AI_DESCRIPTION_LIMITS.max || ai.remainingToday === 0 || ai.request.isPending}>
        {ai.request.isPending ? t('builder.ai.sending') : t('builder.ai.submit')}
      </Button>
    </>
  );

  return (
    <Dialog
      open
      size="wide"
      title={t('builder.ai.title')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (!working && !failed && !tooShort) ai.request.mutate({ description: description.trim(), revision });
      }}
      footer={footer}
    >
      {working ? (
        <div className={styles.aiProgress} role="status" aria-live="polite">
          <p className={styles.strong}>{job.status === 'PENDING' ? t('builder.ai.queued') : t('builder.ai.working')}</p>
          <p className={styles.note}>{t('builder.ai.elapsed', { seconds: elapsed })}</p>
          <p className={styles.note}>{t('builder.ai.canClose')}</p>
        </div>
      ) : failed ? (
        <Alert tone="danger">{t(`builder.ai.jobErrors.${jobErrorOf(job.errorCode)}`)}</Alert>
      ) : (
        <div className={styles.aiForm}>
          <p className={styles.note}>{t('builder.ai.intro')}</p>
          <TextArea
            label={t('builder.ai.description')}
            hint={t('builder.ai.descriptionHint', { count: length, max: AI_DESCRIPTION_LIMITS.max })}
            rows={9}
            maxLength={AI_DESCRIPTION_LIMITS.max}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('builder.ai.placeholder')}
          />
          <p className={styles.note}>{t('builder.ai.privacy')}</p>
          {hasContent && <Alert tone="warn">{t('builder.ai.replaces')}</Alert>}
          <p className={styles.note}>{ai.remainingToday === 0 ? t('builder.ai.noneLeft') : t('builder.ai.remaining', { count: ai.remainingToday })}</p>
          {requestError !== undefined && <Alert tone="danger">{requestError}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
