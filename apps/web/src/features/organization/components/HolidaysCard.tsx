import type { CalendarResponse, HolidayResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { AdminError } from '@/shared/admin/AdminError';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { ApiError } from '@/shared/api';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, PlusIcon, Select, TextField } from '@/shared/ui';
import { addHoliday, holidaysQueryOptions, importHolidays, removeHoliday } from '../api/organization-api';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

const NAME_MAX = 200;
/** Last year (to fix what already counted), this one and the next two. */
const YEARS_BACK = 1;
const YEARS_AHEAD = 2;

/** "lunes, 12 de octubre": a holiday is a calendar day, so it is read as such, without a time zone. */
function holidayDate(date: string): string {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
}

export interface HolidaysCardProps {
  readonly calendar: CalendarResponse;
  readonly countryName: string;
  readonly canEdit: boolean;
}

/** The days of a year that do not count towards a deadline: the country's (imported) and the organization's own. */
export function HolidaysCard({ calendar, countryName, canEdit }: HolidaysCardProps) {
  const { t } = useTranslation(['organization', 'admin']);
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [adding, setAdding] = useState(false);
  const holidays = useQuery(holidaysQueryOptions(useApiClient(), calendar.id, year));
  const imported = useAdminMutation((client, value: number) => importHolidays(client, calendar.id, value));
  const remove = useAdminMutation((client, date: string) => removeHoliday(client, calendar.id, date));
  const years = Array.from({ length: YEARS_BACK + YEARS_AHEAD + 1 }, (_, index) => thisYear - YEARS_BACK + index);

  return (
    <Card title={t('calendars.holidays.title')}>
      <div className={adminStyles.toolbar}>
        <div className={styles.yearField}>
          <Select
            label={t('calendars.holidays.year')}
            value={String(year)}
            options={years.map((candidate) => ({ value: String(candidate), label: String(candidate) }))}
            onChange={(event) => {
              setYear(Number(event.target.value));
              imported.reset();
            }}
          />
        </div>
        {canEdit && (
          <div className={styles.cardActions}>
            {calendar.countryCode !== null && (
              <Button disabled={imported.isPending} onClick={() => imported.mutate(year)}>
                {t('calendars.holidays.import', { country: countryName })}
              </Button>
            )}
            <Button icon={<PlusIcon size={15} />} onClick={() => setAdding(true)}>
              {t('calendars.holidays.add')}
            </Button>
          </div>
        )}
      </div>
      {imported.data !== undefined && <Alert tone="ok">{t('calendars.holidays.imported', { count: imported.data.imported, year })}</Alert>}
      <AdminError error={imported.error ?? remove.error} />
      {holidays.isError ? (
        <Alert tone="danger">{t('admin:list.failed')}</Alert>
      ) : holidays.data === undefined ? (
        <p className={styles.note}>{t('admin:list.loading')}</p>
      ) : holidays.data.length === 0 ? (
        <p className={styles.note}>{calendar.countryCode === null ? t('calendars.holidays.emptyNoCountry', { year }) : t('calendars.holidays.empty', { year })}</p>
      ) : (
        <ul className={styles.levels} aria-label={t('calendars.holidays.listLabel', { year })}>
          {holidays.data.map((holiday: HolidayResponse) => (
            <li key={holiday.date} className={styles.holidayRow}>
              <span className={styles.levelNumber}>{holidayDate(holiday.date)}</span>
              <span>{holiday.name}</span>
              {canEdit && (
                <div className={adminStyles.rowActions}>
                  <Button variant="ghost" aria-label={t('calendars.holidays.removeNamed', { name: holiday.name })} disabled={remove.isPending} onClick={() => remove.mutate(holiday.date)}>
                    {t('calendars.holidays.remove')}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding && <HolidayDialog calendarId={calendar.id} onClose={() => setAdding(false)} />}
    </Card>
  );
}

function HolidayDialog({ calendarId, onClose }: { readonly calendarId: string; readonly onClose: () => void }) {
  const { t } = useTranslation(['organization', 'admin']);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const add = useAdminMutation((client, holiday: { date: string; name: string }) => addHoliday(client, calendarId, holiday));
  // The API says a day is taken as it says a name is: here that means the date.
  const taken = add.error instanceof ApiError && add.error.code === 'DUPLICATE';
  return (
    <AdminDialog
      title={t('calendars.holidays.add')}
      submitLabel={t('admin:dialog.save')}
      pending={add.isPending}
      error={taken ? null : add.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (date !== '' && name.trim() !== '') add.mutate({ date, name: name.trim() }, { onSuccess: onClose });
      }}
    >
      <TextField
        label={t('calendars.holidays.date')}
        type="date"
        required
        value={date}
        error={taken ? t('calendars.holidays.taken') : submitted && date === '' ? t('calendars.holidays.dateRequired') : undefined}
        onChange={(event) => setDate(event.target.value)}
      />
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} placeholder={t('calendars.holidays.namePlaceholder')} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </AdminDialog>
  );
}
