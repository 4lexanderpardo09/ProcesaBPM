import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { plainTextToHtml } from '@/shared/lib/plain-text-html';
import { useApiClient } from '@/shared/session';
import { Alert, Select, TextArea } from '@/shared/ui';
import { errorSubtypesQueryOptions, reportableErrorTypesQueryOptions, reportTicketError } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

interface ReportArgs {
  readonly errorTypeId: string;
  readonly errorSubtypeId: string;
  readonly description: string;
}

/**
 * Reports an error on the open step, attributed to whoever delivered the previous step. What happens next depends on the
 * type, and the dialog says it before sending: only recorded, back to the previous step, or the ticket closes.
 */
export function ReportErrorDialog({ ticketId, visitId, onClose }: { readonly ticketId: string; readonly visitId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const [errorTypeId, setErrorTypeId] = useState('');
  const [errorSubtypeId, setErrorSubtypeId] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const types = useQuery(reportableErrorTypesQueryOptions(client));
  const subtypes = useQuery({ ...errorSubtypesQueryOptions(client, errorTypeId), enabled: errorTypeId !== '' });
  const report = useTicketMutation((c, args: ReportArgs) =>
    reportTicketError(c, ticketId, { visitId, errorTypeId: args.errorTypeId, ...(args.errorSubtypeId === '' ? {} : { errorSubtypeId: args.errorSubtypeId }), description: plainTextToHtml(args.description) }),
  );
  const typeOptions = (types.data ?? []).map((type) => ({ value: type.id, label: type.name }));
  const typeStatus = types.isError ? t('actions.reportError.typesFailed') : types.data === undefined ? t('actions.reportError.typesLoading') : typeOptions.length === 0 ? t('actions.reportError.noTypes') : undefined;
  const subtypeOptions = (subtypes.data ?? []).map((subtype) => ({ value: subtype.id, label: subtype.name }));
  const chosen = types.data?.find((type) => type.id === errorTypeId);
  const effect = chosen === undefined ? undefined : chosen.forcesClose ? 'closes' : chosen.isProcessError ? 'returns' : 'records';
  return (
    <ActionDialog
      open
      title={t('actions.reportError.title')}
      submitLabel={t('actions.reportError.submit')}
      pending={report.isPending}
      error={report.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (errorTypeId !== '' && description.trim() !== '') report.mutate({ errorTypeId, errorSubtypeId, description }, { onSuccess: onClose });
      }}
    >
      <p>{t('actions.reportError.body')}</p>
      <Select
        label={t('actions.reportError.type')}
        required
        value={errorTypeId}
        placeholder={typeStatus ?? t('advance.choose')}
        options={typeOptions}
        disabled={typeOptions.length === 0}
        error={submitted && errorTypeId === '' ? t('actions.reportError.typeRequired') : undefined}
        onChange={(event) => {
          setErrorTypeId(event.target.value);
          setErrorSubtypeId('');
        }}
      />
      {subtypeOptions.length > 0 && (
        <Select label={t('actions.reportError.subtype')} value={errorSubtypeId} placeholder={t('actions.reportError.noSubtype')} options={subtypeOptions} onChange={(event) => setErrorSubtypeId(event.target.value)} />
      )}
      {effect !== undefined && <Alert tone={effect === 'records' ? 'info' : 'warn'}>{t(`actions.reportError.effects.${effect}`)}</Alert>}
      <TextArea
        label={t('actions.reportError.description')}
        required
        value={description}
        maxLength={5000}
        rows={4}
        error={submitted && description.trim() === '' ? t('actions.reportError.descriptionRequired') : undefined}
        onChange={(event) => setDescription(event.target.value)}
      />
    </ActionDialog>
  );
}
