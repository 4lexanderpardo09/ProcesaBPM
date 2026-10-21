import { useTranslation } from 'react-i18next';
import { ApiError } from '@/shared/api';
import { Alert } from '@/shared/ui';
import { ActionError } from '../actions/ActionError';

/** The workflow-level refusals of creating a ticket have their own words; anything else reads like any ticket action. */
const CREATION_CODES = ['WORKFLOW_NOT_AVAILABLE', 'INITIATOR_NOT_ALLOWED', 'COMPANY_REQUIRED'] as const;
type CreationCode = (typeof CREATION_CODES)[number];

const isCreationCode = (code: string): code is CreationCode => (CREATION_CODES as readonly string[]).includes(code);

/** Why the form could not be drawn or the ticket could not be created; nothing when there is no error. */
export function CreationError({ error }: { readonly error: unknown }) {
  const { t } = useTranslation('tickets');
  if (error === null || error === undefined) return null;
  if (error instanceof ApiError && isCreationCode(error.code)) return <Alert tone="danger">{t(`new.errors.${error.code}`)}</Alert>;
  if (error instanceof ApiError && error.status === 404) return <Alert tone="danger">{t('new.errors.NOT_FOUND')}</Alert>;
  return <ActionError error={error} />;
}
