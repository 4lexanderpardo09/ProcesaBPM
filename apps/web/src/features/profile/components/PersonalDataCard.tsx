import type { MeResponse } from '@procesabpm/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { currentUserQueryKey, useApiClient } from '@/shared/session';
import { Alert, Button, Card, TextField } from '@/shared/ui';
import { updateProfile } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const NAME_MAX = 200;
const TIME_ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

/** Name and time zone; without a time zone, dates show in the browser's. The e-mail is read only. */
export function PersonalDataCard({ me }: { readonly me: MeResponse }) {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const zonesId = useId();
  const [firstName, setFirstName] = useState(me.user.firstName);
  const [lastName, setLastName] = useState(me.user.lastName);
  const [timeZone, setTimeZone] = useState(me.user.timeZone ?? '');
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateProfile>[1]) => updateProfile(client, body),
    onSuccess: (profile) => queryClient.setQueryData(currentUserQueryKey, profile),
  });
  const zone = timeZone.trim();
  const zoneInvalid = zone !== '' && !TIME_ZONES.includes(zone);
  const missing = firstName.trim() === '' || lastName.trim() === '';
  const changed = firstName.trim() !== me.user.firstName || lastName.trim() !== me.user.lastName || (zone !== '' && zone !== me.user.timeZone);

  return (
    <Card title={t('data.title')}>
      <form
        noValidate
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (missing || zoneInvalid || !changed) return;
          setSaved(false);
          save.mutate({ firstName: firstName.trim(), lastName: lastName.trim(), ...(zone === '' ? {} : { timeZone: zone }) }, { onSuccess: () => setSaved(true) });
        }}
      >
        <TextField label={t('data.email')} value={me.user.email} readOnly hint={t('data.emailHint')} />
        <div className={styles.pair}>
          <TextField label={t('data.firstName')} required value={firstName} maxLength={NAME_MAX} error={firstName.trim() === '' ? t('data.required') : undefined} onChange={(event) => setFirstName(event.target.value)} />
          <TextField label={t('data.lastName')} required value={lastName} maxLength={NAME_MAX} error={lastName.trim() === '' ? t('data.required') : undefined} onChange={(event) => setLastName(event.target.value)} />
        </div>
        <TextField
          label={t('data.timeZone')}
          hint={t('data.timeZoneHint')}
          value={timeZone}
          list={zonesId}
          placeholder="America/Bogota"
          error={zoneInvalid ? t('data.timeZoneInvalid') : undefined}
          onChange={(event) => setTimeZone(event.target.value)}
        />
        <datalist id={zonesId}>
          {TIME_ZONES.map((candidate) => (
            <option key={candidate} value={candidate} />
          ))}
        </datalist>
        <ProfileError error={save.error} />
        {saved && !changed && <Alert tone="ok">{t('data.saved')}</Alert>}
        <div className={styles.actions}>
          <Button type="submit" variant="brand" disabled={!changed || missing || zoneInvalid || save.isPending}>
            {save.isPending ? t('saving') : t('data.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
