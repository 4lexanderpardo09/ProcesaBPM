import { useTranslation } from 'react-i18next';
import { genericErrorMessage } from '@/shared/api';
import { Alert } from '@/shared/ui';
import { type ProfileErrorContext, profileErrorKey } from '../lib/profile-error';

/** Why a change to one's own account failed; nothing without an error. */
export function ProfileError({ error, context = 'other' }: { readonly error: unknown; readonly context?: ProfileErrorContext }) {
  const { t } = useTranslation('profile');
  const { t: tCommon } = useTranslation();
  if (error === null || error === undefined) return null;
  const key = profileErrorKey(error, context);
  if (key !== undefined) return <Alert tone="danger">{t(key)}</Alert>;
  const generic = genericErrorMessage(error);
  return <Alert tone="danger">{'values' in generic ? tCommon(generic.key, generic.values) : tCommon(generic.key)}</Alert>;
}
