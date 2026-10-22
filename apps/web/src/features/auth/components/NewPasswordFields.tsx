import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/shared/ui';

export interface NewPassword {
  readonly password: string;
  readonly repeat: string;
}

/** What is wrong with the chosen password, or nothing: long enough and typed the same twice. */
export function newPasswordProblem({ password, repeat }: NewPassword): 'tooShort' | 'mismatch' | undefined {
  if (password.length < PASSWORD_MIN_LENGTH) return 'tooShort';
  if (password !== repeat) return 'mismatch';
  return undefined;
}

/** A new password typed twice; the problems show once the person tried to send it. */
export function NewPasswordFields({ value, submitted, onChange }: { readonly value: NewPassword; readonly submitted: boolean; readonly onChange: (value: NewPassword) => void }) {
  const { t } = useTranslation('auth');
  const problem = submitted ? newPasswordProblem(value) : undefined;
  return (
    <>
      <TextField
        label={t('newPassword.password')}
        type="password"
        autoComplete="new-password"
        required
        maxLength={PASSWORD_MAX_LENGTH}
        hint={t('newPassword.rule', { count: PASSWORD_MIN_LENGTH })}
        error={problem === 'tooShort' ? t('newPassword.tooShort', { count: PASSWORD_MIN_LENGTH }) : undefined}
        value={value.password}
        onChange={(event) => onChange({ ...value, password: event.target.value })}
      />
      <TextField
        label={t('newPassword.repeat')}
        type="password"
        autoComplete="new-password"
        required
        maxLength={PASSWORD_MAX_LENGTH}
        error={problem === 'mismatch' ? t('newPassword.mismatch') : undefined}
        value={value.repeat}
        onChange={(event) => onChange({ ...value, repeat: event.target.value })}
      />
    </>
  );
}
