import { AI_NOTICE_VERSION, type AiJobSummary, type AiUsageDay } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Alert, Badge, type BadgeTone, Button, Card, Checkbox, Table, type TableColumn } from '@/shared/ui';
import { aiAssistantQueryOptions, aiUsageQueryOptions, saveAiAssistant, settingsQueryKeys } from '../api/settings-api';
import { SettingsError } from './SettingsError';
import styles from './Settings.module.css';

const STATUS_TONE: Readonly<Record<AiJobSummary['status'], BadgeTone>> = { PENDING: 'neutral', RUNNING: 'accent', SUCCEEDED: 'ok', FAILED: 'danger' };
const number = new Intl.NumberFormat('es-CO');

/**
 * «Crear con IA»: the administrator turns it on accepting the transfer notice (descriptions go to the provider, abroad),
 * and sees what it costs. The notice version accepted is what the audit trail records.
 */
export function AiAssistantTab() {
  const { t } = useTranslation('settings');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const settings = useQuery(aiAssistantQueryOptions(client));
  const save = useMutation({
    mutationFn: (enabled: boolean) => saveAiAssistant(client, enabled ? { enabled, acceptedNoticeVersion: AI_NOTICE_VERSION } : { enabled }),
    onSuccess: (saved) => {
      queryClient.setQueryData(settingsQueryKeys.aiAssistant, saved);
      setAccepted(false);
    },
  });
  const data = settings.data;
  if (data === undefined) return <p className={styles.note}>{settings.isError ? t('loadFailed') : t('loading')}</p>;
  if (!data.available) {
    return (
      <Card title={t('ai.title')}>
        <p className={styles.note}>{t('ai.unavailable')}</p>
      </Card>
    );
  }
  return (
    <div className={styles.stack}>
      <Card title={t('ai.title')} actions={<Badge tone={data.enabled ? 'ok' : 'neutral'}>{data.enabled ? t('ai.on') : t('ai.off')}</Badge>}>
        <div className={styles.stack}>
          <p className={styles.note}>{t('ai.what')}</p>
          {data.enabled ? (
            <>
              <p className={styles.note}>{t('ai.notice.kept')}</p>
              <p className={styles.strong}>{t('ai.today', { jobs: data.today.jobs, maxJobs: data.limits.jobsPerDay, tokens: number.format(data.today.tokens), maxTokens: number.format(data.limits.tokensPerDay) })}</p>
              <div>
                <Button disabled={save.isPending} onClick={() => save.mutate(false)}>
                  {t('ai.turnOff')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Alert tone="info">
                <span className={styles.stack}>
                  <span>{t('ai.notice.transfer')}</span>
                  <span>{t('ai.notice.sent')}</span>
                  <span>{t('ai.notice.neverSent')}</span>
                  <span>{t('ai.notice.kept')}</span>
                </span>
              </Alert>
              <Checkbox label={t('ai.notice.accept')} checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
              <div>
                <Button variant="primary" disabled={!accepted || save.isPending} onClick={() => save.mutate(true)}>
                  {t('ai.turnOn')}
                </Button>
              </div>
            </>
          )}
          <SettingsError error={save.error} />
        </div>
      </Card>
      <AiUsageCard />
    </div>
  );
}

function AiUsageCard() {
  const { t } = useTranslation('settings');
  const usage = useQuery(aiUsageQueryOptions(useApiClient()));
  const days: TableColumn<AiUsageDay>[] = [
    { key: 'date', header: t('ai.usage.date'), cell: (row) => row.date, code: true, width: '120px' },
    { key: 'model', header: t('ai.usage.model'), cell: (row) => row.model, code: true },
    { key: 'calls', header: t('ai.usage.calls'), cell: (row) => number.format(row.calls), code: true, width: '90px' },
    { key: 'prompt', header: t('ai.usage.prompt'), cell: (row) => number.format(row.promptTokens), code: true },
    { key: 'completion', header: t('ai.usage.completion'), cell: (row) => number.format(row.completionTokens), code: true },
    { key: 'reasoning', header: t('ai.usage.reasoning'), cell: (row) => number.format(row.reasoningTokens), code: true },
  ];
  const jobs: TableColumn<AiJobSummary>[] = [
    { key: 'createdAt', header: t('ai.jobs.createdAt'), cell: (row) => formatDateTime(row.createdAt), width: '160px' },
    { key: 'requester', header: t('ai.jobs.requester'), cell: (row) => row.requesterName },
    { key: 'status', header: t('ai.jobs.status'), cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`ai.jobs.statuses.${row.status}`)}</Badge>, width: '130px' },
    { key: 'tokens', header: t('ai.jobs.tokens'), cell: (row) => number.format(row.tokens), code: true, width: '110px' },
  ];
  return (
    <Card title={t('ai.usage.title')}>
      <div className={styles.stack}>
        <p className={styles.note}>{t('ai.usage.hint')}</p>
        <Table label={t('ai.usage.title')} columns={days} rows={usage.data?.days ?? []} rowKey={(row) => `${row.date}-${row.model}`} empty={t('ai.usage.empty')} loading={usage.isPending} loadingLabel={t('loading')} />
        <p className={styles.small}>{t('ai.jobs.title')}</p>
        <Table label={t('ai.jobs.title')} columns={jobs} rows={usage.data?.recentJobs ?? []} rowKey={(row) => row.id} empty={t('ai.jobs.empty')} loading={usage.isPending} loadingLabel={t('loading')} />
      </div>
    </Card>
  );
}
