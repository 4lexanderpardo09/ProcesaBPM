import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Select, isBlankRichText, RichTextEditor } from '@/shared/ui';
import { errorSubtypesQueryOptions, reopenTicket, reopeningErrorTypesQueryOptions } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

interface ReopenArgs {
  readonly errorTypeId: string;
  readonly errorSubtypeId: string;
  readonly description: string;
}

/**
 * Reopens a closed ticket on its last step, back with whoever held it. Every reopening files an error of a reopening
 * type against whoever closed it, so the type and what went wrong are required; the subtype only refines it.
 */
export function ReopenDialog({ ticketId, onClose }: { readonly ticketId: string; readonly onClose: () => void }) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const [errorTypeId, setErrorTypeId] = useState('');
  const [errorSubtypeId, setErrorSubtypeId] = useState('');
  const [description, setDescription] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const types = useQuery(reopeningErrorTypesQueryOptions(client));
  const subtypes = useQuery({ ...errorSubtypesQueryOptions(client, errorTypeId), enabled: errorTypeId !== '' });
  const reopen = useTicketMutation((c, args: ReopenArgs) =>
    reopenTicket(c, ticketId, { errorTypeId: args.errorTypeId, ...(args.errorSubtypeId === '' ? {} : { errorSubtypeId: args.errorSubtypeId }), description: args.description }),
  );
  const typeOptions = (types.data ?? []).map((type) => ({ value: type.id, label: type.name }));
  const typeStatus = types.isError ? t('actions.reopen.typesFailed') : types.data === undefined ? t('actions.reopen.typesLoading') : typeOptions.length === 0 ? t('actions.reopen.noTypes') : undefined;
  const subtypeOptions = (subtypes.data ?? []).map((subtype) => ({ value: subtype.id, label: subtype.name }));
  return (
    <ActionDialog
      open
      title={t('actions.reopen.title')}
      submitLabel={t('actions.reopen.submit')}
      pending={reopen.isPending}
      error={reopen.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (errorTypeId !== '' && !isBlankRichText(description)) reopen.mutate({ errorTypeId, errorSubtypeId, description }, { onSuccess: onClose });
      }}
    >
      <p>{t('actions.reopen.body')}</p>
      <Select
        label={t('actions.reopen.type')}
        required
        value={errorTypeId}
        placeholder={typeStatus ?? t('advance.choose')}
        options={typeOptions}
        disabled={typeOptions.length === 0}
        error={submitted && errorTypeId === '' ? t('actions.reopen.typeRequired') : undefined}
        onChange={(event) => {
          setErrorTypeId(event.target.value);
          setErrorSubtypeId('');
        }}
      />
      {subtypeOptions.length > 0 && (
        <Select label={t('actions.reopen.subtype')} value={errorSubtypeId} placeholder={t('actions.reopen.noSubtype')} options={subtypeOptions} onChange={(event) => setErrorSubtypeId(event.target.value)} />
      )}
      <RichTextEditor
        label={t('actions.reopen.description')}
        required
        value={description}
        maxLength={RICH_TEXT_MAX}
        error={submitted && isBlankRichText(description) ? t('actions.reopen.descriptionRequired') : undefined}
        onValueChange={setDescription}
      />
    </ActionDialog>
  );
}
