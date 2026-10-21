import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminError } from '@/shared/admin/AdminError';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Alert, Button, Card, Select, TextField } from '@/shared/ui';
import { previewDueDate } from '../api/organization-api';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

type Unit = 'BUSINESS_HOURS' | 'BUSINESS_DAYS';

/** `yyyy-MM-ddTHH:mm` of now in the browser's time zone, what a `datetime-local` field shows. */
function nowForInput(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * Tries the calendar out: when a deadline started at a given moment would fall, counted only in working hours and
 * skipping holidays, as an SLA counts it. Nothing is saved.
 */
export function DueDatePreviewCard({ calendarId }: { readonly calendarId: string }) {
  const { t } = useTranslation(['organization', 'admin']);
  const [start, setStart] = useState(nowForInput);
  const [amount, setAmount] = useState('8');
  const [unit, setUnit] = useState<Unit>('BUSINESS_HOURS');
  const preview = useAdminMutation((client, request: { start: string; amount: number; unit: Unit }) => previewDueDate(client, calendarId, request));
  const value = Number(amount.replace(',', '.'));
  const amountInvalid = !(value > 0);

  return (
    <Card title={t('calendars.preview.title')}>
      <p className={styles.note}>{t('calendars.preview.hint')}</p>
      <form
        className={adminStyles.toolbar}
        onSubmit={(event) => {
          event.preventDefault();
          if (!amountInvalid && start !== '') preview.mutate({ start: new Date(start).toISOString(), amount: value, unit });
        }}
      >
        <TextField label={t('calendars.preview.start')} type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} />
        <div className={styles.amountField}>
          <TextField label={t('calendars.preview.amount')} inputMode="decimal" required value={amount} error={amountInvalid ? t('calendars.preview.amountInvalid') : undefined} onChange={(event) => setAmount(event.target.value)} />
        </div>
        <Select
          label={t('calendars.preview.unit')}
          value={unit}
          options={[
            { value: 'BUSINESS_HOURS', label: t('calendars.preview.hours') },
            { value: 'BUSINESS_DAYS', label: t('calendars.preview.days') },
          ]}
          onChange={(event) => setUnit(event.target.value === 'BUSINESS_DAYS' ? 'BUSINESS_DAYS' : 'BUSINESS_HOURS')}
        />
        <Button type="submit" variant="primary" disabled={preview.isPending}>
          {t('calendars.preview.calculate')}
        </Button>
      </form>
      <AdminError error={preview.error} />
      {preview.data !== undefined && (
        <Alert tone="info">
          {t('calendars.preview.result', { date: formatDateTime(preview.data.dueDate, preview.data.timeZone), timeZone: preview.data.timeZone })}
        </Alert>
      )}
    </Card>
  );
}
