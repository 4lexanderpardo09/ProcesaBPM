import { useTranslation } from 'react-i18next';
import { AdminError } from '@/shared/admin/AdminError';
import { Alert } from '@/shared/ui';
import { peopleErrorKey } from '../lib/people-error';

/** Why a change on these screens failed: the reasons only they have, else the shared admin messages. */
export function PeopleError({ error, context }: { readonly error: unknown; readonly context: Parameters<typeof peopleErrorKey>[1] }) {
  const { t } = useTranslation('people');
  const key = peopleErrorKey(error, context);
  return key === undefined ? <AdminError error={error} /> : <Alert tone="danger">{t(key)}</Alert>;
}
