import type { CountrySummary } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dialog, PageHeader, PlusIcon, Select, Table, TextField } from '@/shared/ui';
import { addHoliday, countriesQueryOptions, createCountry, holidaysQueryOptions, platformQueryKeys, regenerateHolidays, removeHoliday } from '../api/platform-api';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

const THIS_YEAR = new Date().getFullYear();
const YEARS = [THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1, THIS_YEAR + 2];
/** `2026-12-25` as `25/12/2026`: a calendar date has no time zone. */
const dayMonthYear = (date: string) => `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;

/** The countries an organization can be in, and each one's holidays by year (business time counts them). */
export function CountriesPage() {
  const { t } = useTranslation('platform');
  const countries = useQuery(countriesQueryOptions(usePlatformClient()));
  const [code, setCode] = useState<string>();
  const [adding, setAdding] = useState(false);
  const chosen = countries.data?.find((country) => country.code === (code ?? countries.data[0]?.code));
  return (
    <>
      <PageHeader
        title={t('countries.title')}
        subtitle={t('countries.subtitle')}
        actions={
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setAdding(true)}>
            {t('countries.add')}
          </Button>
        }
      />
      <div className={styles.stack}>
        {countries.isError && <PlatformError error={countries.error} onRetry={() => void countries.refetch()} />}
        <Table<CountrySummary>
          label={t('countries.title')}
          rows={countries.data ?? []}
          rowKey={(row) => row.code}
          loading={countries.data === undefined && !countries.isError}
          loadingLabel={t('loading')}
          empty={t('countries.empty')}
          onRowClick={(row) => setCode(row.code)}
          columns={[
            { key: 'name', header: t('countries.columns.name'), cell: (row) => row.name },
            { key: 'code', header: t('countries.columns.code'), code: true, width: '80px', cell: (row) => row.code },
            { key: 'currency', header: t('countries.columns.currency'), width: '90px', cell: (row) => row.currencyCode },
            { key: 'zone', header: t('countries.columns.timeZone'), cell: (row) => row.timeZone },
            { key: 'tenants', header: t('countries.columns.tenants'), width: '120px', cell: (row) => String(row.tenants) },
          ]}
        />
        {chosen !== undefined && <Holidays key={chosen.code} country={chosen} />}
      </div>
      {adding && <CountryDialog onClose={() => setAdding(false)} />}
    </>
  );
}

/** A country's holidays of a year: added and removed by hand, or drawn again from the rules when the platform has them. */
function Holidays({ country }: { readonly country: CountrySummary }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [year, setYear] = useState(THIS_YEAR);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const holidays = useQuery(holidaysQueryOptions(client, country.code, year));
  const refresh = () => queryClient.invalidateQueries({ queryKey: platformQueryKeys.holidays(country.code, year) });
  const add = useMutation({
    mutationFn: () => addHoliday(client, country.code, { date, name: name.trim() }),
    onSuccess: async () => {
      setDate('');
      setName('');
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: (day: string) => removeHoliday(client, country.code, day), onSuccess: () => refresh() });
  const regenerate = useMutation({ mutationFn: () => regenerateHolidays(client, country.code, year), onSuccess: (result) => queryClient.setQueryData(platformQueryKeys.holidays(country.code, year), result.holidays) });
  return (
    <Card title={t('countries.holidays', { country: country.name })}>
      <div className={styles.stack}>
        <div className={styles.actions}>
          <Select label={t('countries.year')} options={YEARS.map((value) => ({ value: String(value), label: String(value) }))} value={String(year)} onChange={(event) => setYear(Number(event.target.value))} />
          {country.hasHolidayGenerator && (
            <Button disabled={regenerate.isPending} onClick={() => regenerate.mutate()}>
              {t('countries.regenerate')}
            </Button>
          )}
        </div>
        <Table
          label={t('countries.holidays', { country: country.name })}
          rows={holidays.data ?? []}
          rowKey={(row) => row.date}
          loading={holidays.data === undefined && !holidays.isError}
          loadingLabel={t('loading')}
          empty={t('countries.noHolidays')}
          columns={[
            { key: 'date', header: t('countries.date'), width: '120px', cell: (row) => dayMonthYear(row.date) },
            { key: 'name', header: t('countries.holidayName'), cell: (row) => row.name },
            {
              key: 'remove',
              header: '',
              width: '100px',
              cell: (row) => (
                <Button variant="ghost" disabled={remove.isPending} aria-label={t('countries.removeHoliday', { name: row.name })} onClick={() => remove.mutate(row.date)}>
                  {t('announcements.removeAction')}
                </Button>
              ),
            },
          ]}
        />
        <form
          className={styles.actions}
          onSubmit={(event) => {
            event.preventDefault();
            if (date !== '' && name.trim() !== '' && !add.isPending) add.mutate();
          }}
        >
          <TextField label={t('countries.date')} type="date" min={`${String(year)}-01-01`} max={`${String(year)}-12-31`} value={date} onChange={(event) => setDate(event.target.value)} />
          <TextField label={t('countries.holidayName')} maxLength={200} value={name} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" disabled={add.isPending}>
            {t('countries.addHoliday')}
          </Button>
        </form>
        {[holidays.error, add.error, remove.error, regenerate.error].map((error, index) => (error === null ? null : <PlatformError key={index} error={error} />))}
      </div>
    </Card>
  );
}

function CountryDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ code: '', name: '', currencyCode: '', timeZone: '' });
  const [submitted, setSubmitted] = useState(false);
  const valid = /^[A-Z]{2}$/.test(form.code) && form.name.trim() !== '' && /^[A-Z]{3}$/.test(form.currencyCode) && form.timeZone.trim() !== '';
  const create = useMutation({
    mutationFn: () => createCountry(client, { code: form.code, name: form.name.trim(), currencyCode: form.currencyCode, timeZone: form.timeZone.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.countries() });
      onClose();
    },
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const bad = (ok: boolean) => (submitted && !ok ? t('plans.form.invalid') : undefined);
  return (
    <Dialog
      open
      title={t('countries.add')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid && !create.isPending) create.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={create.isPending}>
            {t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <TextField label={t('countries.columns.code')} hint={t('countries.codeHint')} required maxLength={2} error={bad(/^[A-Z]{2}$/.test(form.code))} value={form.code} onChange={(event) => set('code', event.target.value.toUpperCase())} />
        <TextField label={t('countries.columns.name')} required maxLength={100} error={bad(form.name.trim() !== '')} value={form.name} onChange={(event) => set('name', event.target.value)} />
        <TextField label={t('countries.columns.currency')} hint={t('countries.currencyHint')} required maxLength={3} error={bad(/^[A-Z]{3}$/.test(form.currencyCode))} value={form.currencyCode} onChange={(event) => set('currencyCode', event.target.value.toUpperCase())} />
        <TextField label={t('countries.columns.timeZone')} hint={t('countries.timeZoneHint')} required maxLength={64} error={bad(form.timeZone.trim() !== '')} value={form.timeZone} onChange={(event) => set('timeZone', event.target.value)} />
        {create.isError && <PlatformError error={create.error} />}
      </div>
    </Dialog>
  );
}
