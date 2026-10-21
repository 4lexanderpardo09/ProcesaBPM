import { type CalendarResponse, calendarResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient } from '@/shared/session';
import { Select, TextField } from '@/shared/ui';
import { countriesQueryOptions } from '../api/organization-api';

const NAME_MAX = 200;

export interface CalendarDialogProps {
  readonly record: CalendarResponse | undefined;
  readonly onClose: () => void;
  /** A new calendar is shown right away, to fill in its hours. */
  readonly onCreated?: (calendar: CalendarResponse) => void;
}

/** A calendar's name and country: the country gives the holidays to import and, by default, the time zone of its deadlines. */
export function CalendarDialog({ record, onClose, onCreated }: CalendarDialogProps) {
  const { t } = useTranslation(['organization', 'admin']);
  const countries = useQuery(countriesQueryOptions(useApiClient()));
  const [name, setName] = useState(record?.name ?? '');
  const [countryCode, setCountryCode] = useState(record?.countryCode ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/calendars', calendarResponseSchema, record?.id, body));

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const body = record === undefined ? { name: name.trim(), ...(countryCode === '' ? {} : { countryCode }) } : { name: name.trim(), countryCode: countryCode === '' ? null : countryCode };
    save.mutate(body, {
      onSuccess: (saved) => {
        if (record === undefined) onCreated?.(saved);
        onClose();
      },
    });
  };

  return (
    <AdminDialog title={record === undefined ? t('calendars.new') : t('calendars.edit')} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <Select
        label={t('calendars.country')}
        hint={t('calendars.countryHint')}
        value={countryCode}
        placeholder={t('calendars.noCountry')}
        options={(countries.data ?? []).map((country) => ({ value: country.code, label: country.name }))}
        onChange={(event) => setCountryCode(event.target.value)}
      />
    </AdminDialog>
  );
}
