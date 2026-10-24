import { RICH_TEXT_MAX } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isBlankRichText, RichTextEditor } from '@/shared/ui';
import { resolveIncident } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionDialog } from './ActionDialog';

export interface ResolveIncidentDialogProps {
  readonly ticketId: string;
  readonly incidentId: string;
  readonly onClose: () => void;
}

/** Says how the problem was sorted out; the ticket goes back to its holders and its SLA runs again. */
export function ResolveIncidentDialog({ ticketId, incidentId, onClose }: ResolveIncidentDialogProps) {
  const { t } = useTranslation('tickets');
  const [resolution, setResolution] = useState('');
  const [missing, setMissing] = useState(false);
  const resolve = useTicketMutation((client, text: string) => resolveIncident(client, ticketId, incidentId, text));
  return (
    <ActionDialog
      open
      title={t('actions.resolve.title')}
      submitLabel={t('actions.resolve.submit')}
      pending={resolve.isPending}
      error={resolve.error}
      onClose={onClose}
      onSubmit={() => (isBlankRichText(resolution) ? setMissing(true) : resolve.mutate(resolution, { onSuccess: onClose }))}
    >
      <RichTextEditor
        label={t('actions.resolve.resolution')}
        required
        value={resolution}
        maxLength={RICH_TEXT_MAX}
        error={missing ? t('actions.resolve.resolutionRequired') : undefined}
        onValueChange={(next) => {
          setResolution(next);
          setMissing(false);
        }}
      />
    </ActionDialog>
  );
}
