import { PASSWORD_MIN_LENGTH } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, TextField } from '@/shared/ui';
import { changePassword } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

/** Changing the password asks for the current one; the new one is typed twice. */
export function PasswordCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const change = useMutation({ mutationFn: () => changePassword(client, { currentPassword: current, newPassword: next }) });
  const tooShort = next !== '' && next.length < PASSWORD_MIN_LENGTH;
  const mismatch = repeat !== '' && repeat !== next;

  return (
    <Card title={t('password.title')}>
      <form
        noValidate
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          setDone(false);
          if (current === '' || next.length < PASSWORD_MIN_LENGTH || repeat !== next) return;
          change.mutate(undefined, {
            onSuccess: () => {
              setCurrent('');
              setNext('');
              setRepeat('');
              setSubmitted(false);
              setDone(true);
            },
          });
        }}
      >
        <TextField label={t('password.current')} type="password" autoComplete="current-password" required value={current} error={submitted && current === '' ? t('data.required') : undefined} onChange={(event) => setCurrent(event.target.value)} />
        <div className={styles.pair}>
          <TextField
            label={t('password.new')}
            type="password"
            autoComplete="new-password"
            required
            value={next}
            hint={t('password.rule', { count: PASSWORD_MIN_LENGTH })}
            error={tooShort || (submitted && next === '') ? t('password.tooShort', { count: PASSWORD_MIN_LENGTH }) : undefined}
            onChange={(event) => setNext(event.target.value)}
          />
          <TextField label={t('password.repeat')} type="password" autoComplete="new-password" required value={repeat} error={mismatch || (submitted && repeat === '') ? t('password.mismatch') : undefined} onChange={(event) => setRepeat(event.target.value)} />
        </div>
        <ProfileError error={change.error} context="password" />
        {done && <Alert tone="ok">{t('password.changed')}</Alert>}
        <div className={styles.actions}>
          <Button type="submit" variant="brand" disabled={change.isPending}>
            {change.isPending ? t('saving') : t('password.save')}
          </Button>
        </div>
      </form>
    </Card>
  );
}
