import { useTranslation } from 'react-i18next';
import { genericErrorMessage } from '@/shared/api';
import { Alert } from '@/shared/ui';
import { profileErrorKey } from '../lib/profile-error';

/** Why a change to one's own account failed; nothing without an error. */
export function ProfileError({ error, factor }: { readonly error: unknown; readonly factor?: 'code' | 'backupCode' }) {
  const { t } = useTranslation('profile');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const key = profileErrorKey(error, factor);
  if (key !== undefined) return <Alert tone="danger">{t(key)}</Alert>;
  const generic = genericErrorMessage(error);
  return <Alert tone="danger">{'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key)}</Alert>;
}
