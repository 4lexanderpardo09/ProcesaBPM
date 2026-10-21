import { type CompanyResponse, companyResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { currentUserQueryKey, useApiClient, usePermissions } from '@/shared/session';
import { Select, TextField } from '@/shared/ui';
import { calendarsQueryOptions, countriesQueryOptions } from '../api/organization-api';

const NAME_MAX = 200;
const TAX_ID_MAX = 50;
const CURRENCY = /^[A-Z]{3}$/;
const TIME_ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

/**
 * A company: its name, tax id (NIT), country and, optionally, its own currency, time zone and calendar. On a new
 * company, what is left empty takes the country's (the API fills it in).
 */
export function CompanyDialog({ record, onClose }: { readonly record: CompanyResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['organization', 'admin']);
  const { can } = usePermissions();
  const zonesId = useId();
  const client = useApiClient();
  const countries = useQuery(countriesQueryOptions(client));
  const calendars = useQuery({ ...calendarsQueryOptions(client), enabled: can('read', 'Calendar') });
  const [name, setName] = useState(record?.name ?? '');
  const [taxId, setTaxId] = useState(record?.taxId ?? '');
  const [countryCode, setCountryCode] = useState(record?.countryCode ?? '');
  const [currencyCode, setCurrencyCode] = useState(record?.currencyCode ?? '');
  const [timeZone, setTimeZone] = useState(record?.timeZone ?? '');
  const [calendarId, setCalendarId] = useState(record?.calendarId ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/companies', companyResponseSchema, record?.id, body), [currentUserQueryKey]);
  const currency = currencyCode.trim().toUpperCase();
  const zone = timeZone.trim();
  const currencyInvalid = currency !== '' && !CURRENCY.test(currency);
  const zoneInvalid = zone !== '' && !TIME_ZONES.includes(zone);
  const nameMissing = submitted && name.trim() === '';

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '' || countryCode === '' || currencyInvalid || zoneInvalid) return;
    const tax = taxId.trim();
    const body =
      record === undefined
        ? { name: name.trim(), countryCode, ...(tax === '' ? {} : { taxId: tax }), ...(currency === '' ? {} : { currencyCode: currency }), ...(zone === '' ? {} : { timeZone: zone }), ...(calendarId === '' ? {} : { calendarId }) }
        : { name: name.trim(), countryCode, taxId: tax === '' ? null : tax, ...(currency === '' ? {} : { currencyCode: currency }), ...(zone === '' ? {} : { timeZone: zone }), calendarId: calendarId === '' ? null : calendarId };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <AdminDialog title={record === undefined ? t('companies.new') : t('companies.edit')} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={nameMissing ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextField label={t('companies.taxId')} value={taxId} maxLength={TAX_ID_MAX} onChange={(event) => setTaxId(event.target.value)} />
      <Select
        label={t('companies.country')}
        required
        value={countryCode}
        placeholder={countries.data === undefined ? t('admin:list.loading') : t('companies.chooseCountry')}
        options={(countries.data ?? []).map((country) => ({ value: country.code, label: country.name }))}
        error={submitted && countryCode === '' ? t('companies.countryRequired') : undefined}
        onChange={(event) => setCountryCode(event.target.value)}
      />
      <TextField
        label={t('companies.currency')}
        hint={record === undefined ? t('companies.fromCountry') : undefined}
        value={currencyCode}
        maxLength={3}
        placeholder="COP"
        error={currencyInvalid ? t('companies.currencyInvalid') : undefined}
        onChange={(event) => setCurrencyCode(event.target.value)}
      />
      <TextField
        label={t('companies.timeZone')}
        hint={record === undefined ? t('companies.fromCountry') : undefined}
        value={timeZone}
        list={zonesId}
        placeholder="America/Bogota"
        error={zoneInvalid ? t('companies.timeZoneInvalid') : undefined}
        onChange={(event) => setTimeZone(event.target.value)}
      />
      <datalist id={zonesId}>
        {TIME_ZONES.map((candidate) => (
          <option key={candidate} value={candidate} />
        ))}
      </datalist>
      {calendars.data !== undefined && (
        <Select
          label={t('companies.calendar')}
          hint={t('companies.calendarHint')}
          value={calendarId}
          placeholder={t('companies.defaultCalendar')}
          options={calendars.data.map((calendar) => ({ value: calendar.id, label: calendar.name }))}
          onChange={(event) => setCalendarId(event.target.value)}
        />
      )}
    </AdminDialog>
  );
}
