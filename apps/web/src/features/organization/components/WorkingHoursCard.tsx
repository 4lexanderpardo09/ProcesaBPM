import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, PlusIcon, TextField } from '@/shared/ui';
import { calendarDetailQueryOptions, replaceWorkingDay } from '../api/organization-api';
import { MAX_SLOTS_PER_DAY, type Slot, slotIssues, slotsOf, WEEK_ORDER, type Weekday, weeklyMinutes } from '../lib/working-week';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

const DAY_KEYS = {
  0: 'calendars.weekdays.sunday',
  1: 'calendars.weekdays.monday',
  2: 'calendars.weekdays.tuesday',
  3: 'calendars.weekdays.wednesday',
  4: 'calendars.weekdays.thursday',
  5: 'calendars.weekdays.friday',
  6: 'calendars.weekdays.saturday',
} as const satisfies Record<Weekday, string>;

/** The working hours of each weekday; a day without slots does not count towards a deadline. */
export function WorkingHoursCard({ calendarId, canEdit }: { readonly calendarId: string; readonly canEdit: boolean }) {
  const { t } = useTranslation(['organization', 'admin']);
  const detail = useQuery(calendarDetailQueryOptions(useApiClient(), calendarId));
  const [editing, setEditing] = useState<Weekday>();
  const hours = detail.data?.workingHours ?? [];
  const weekly = weeklyMinutes(hours);

  return (
    <Card title={t('calendars.hours.title')}>
      {detail.isError && <Alert tone="danger">{t('admin:list.failed')}</Alert>}
      {detail.data !== undefined && <p className={styles.note}>{weekly % 60 === 0 ? t('calendars.hours.weekly', { hours: weekly / 60 }) : t('calendars.hours.weeklyWithMinutes', { hours: Math.floor(weekly / 60), minutes: weekly % 60 })}</p>}
      <ul className={styles.levels} aria-label={t('calendars.hours.title')}>
        {WEEK_ORDER.map((weekday) => {
          const slots = slotsOf(hours, weekday);
          return (
            <li key={weekday} className={styles.levelRow}>
              <span className={styles.levelNumber}>{t(DAY_KEYS[weekday])}</span>
              <span>{detail.data === undefined ? '…' : slots.length === 0 ? <span className={styles.faint}>{t('calendars.hours.closed')}</span> : slots.map((slot) => `${slot.startTime}–${slot.endTime}`).join(', ')}</span>
              {canEdit && detail.data !== undefined && (
                <div className={adminStyles.rowActions}>
                  <Button variant="ghost" aria-label={t('calendars.hours.editDay', { day: t(DAY_KEYS[weekday]).toLocaleLowerCase('es') })} onClick={() => setEditing(weekday)}>
                    {t('admin:list.edit')}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing !== undefined && <WorkingDayDialog calendarId={calendarId} weekday={editing} current={slotsOf(hours, editing)} onClose={() => setEditing(undefined)} />}
    </Card>
  );
}

const ISSUE_KEYS = { incomplete: 'calendars.hours.incomplete', endsBeforeStart: 'calendars.hours.endsBeforeStart', overlaps: 'calendars.hours.overlaps' } as const;

function WorkingDayDialog({ calendarId, weekday, current, onClose }: { readonly calendarId: string; readonly weekday: Weekday; readonly current: readonly Slot[]; readonly onClose: () => void }) {
  const { t } = useTranslation(['organization', 'admin']);
  const [slots, setSlots] = useState<readonly Slot[]>(current);
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: readonly Slot[]) => replaceWorkingDay(client, calendarId, weekday, value));
  const issues = slotIssues(slots);
  const day = t(DAY_KEYS[weekday]);
  const change = (index: number, patch: Partial<Slot>) => setSlots(slots.map((slot, at) => (at === index ? { ...slot, ...patch } : slot)));

  return (
    <AdminDialog
      title={t('calendars.hours.dayTitle', { day: day.toLocaleLowerCase('es') })}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (issues.size === 0) save.mutate([...slots].sort((a, b) => a.startTime.localeCompare(b.startTime)), { onSuccess: onClose });
      }}
    >
      <p className={styles.note}>{slots.length === 0 ? t('calendars.hours.noSlots') : t('calendars.hours.slotsHint')}</p>
      {slots.map((slot, index) => {
        const issue = submitted ? issues.get(index) : undefined;
        return (
          // Slots have no identity of their own: they are edited in place and the index is stable until one is removed.
          <fieldset key={index} className={styles.slotRow}>
            <legend className={styles.visuallyHidden}>{t('calendars.hours.slot', { number: index + 1 })}</legend>
            <TextField label={t('calendars.hours.from')} type="time" required value={slot.startTime} error={issue === undefined ? undefined : t(ISSUE_KEYS[issue])} onChange={(event) => change(index, { startTime: event.target.value })} />
            <TextField label={t('calendars.hours.to')} type="time" required value={slot.endTime} onChange={(event) => change(index, { endTime: event.target.value })} />
            <Button variant="ghost" aria-label={t('calendars.hours.removeSlot', { number: index + 1 })} onClick={() => setSlots(slots.filter((_, at) => at !== index))}>
              {t('calendars.hours.remove')}
            </Button>
          </fieldset>
        );
      })}
      {slots.length < MAX_SLOTS_PER_DAY && (
        <div>
          <Button icon={<PlusIcon size={15} />} onClick={() => setSlots([...slots, { startTime: '', endTime: '' }])}>
            {t('calendars.hours.addSlot')}
          </Button>
        </div>
      )}
    </AdminDialog>
  );
}
