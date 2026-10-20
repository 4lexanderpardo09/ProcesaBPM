import type { TicketDetailResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { takeTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { ActionError } from './ActionError';
import { CloseDialog } from './CloseDialog';
import { OpenIncidentDialog } from './OpenIncidentDialog';
import { ReassignDialog } from './ReassignDialog';
import { ResolveIncidentDialog } from './ResolveIncidentDialog';
import styles from './TicketActions.module.css';

type OpenDialog = 'reassign' | 'close' | 'incident' | 'resolve';

/** The actions the API says the person may take now (`actions`); each one that needs input opens its dialog. */
export function TicketActions({ ticket }: { readonly ticket: TicketDetailResponse }) {
  const { t } = useTranslation('tickets');
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const take = useTicketMutation((client, visitId: string) => takeTicket(client, ticket.id, visitId));
  const { actions } = ticket;
  const visitId = ticket.openVisit?.id;
  const incidentId = ticket.openIncident?.id;
  const closeDialog = () => setDialog(null);

  const onVisit = visitId !== undefined;
  const buttons = [
    actions.resolveIncident && incidentId !== undefined && <Button key="resolve" variant="primary" onClick={() => setDialog('resolve')}>{t('actions.resolve.open')}</Button>,
    actions.take && onVisit && (
      <Button key="take" variant="primary" disabled={take.isPending} onClick={() => take.mutate(visitId)}>
        {take.isPending ? t('actions.sending') : t('actions.take')}
      </Button>
    ),
    actions.reassign && onVisit && <Button key="reassign" onClick={() => setDialog('reassign')}>{t('actions.reassign.open')}</Button>,
    actions.openIncident && onVisit && <Button key="incident" onClick={() => setDialog('incident')}>{t('actions.incident.open')}</Button>,
    actions.close && onVisit && <Button key="close" onClick={() => setDialog('close')}>{t('actions.close.open')}</Button>,
  ].filter(Boolean);
  if (buttons.length === 0) return null;

  return (
    <div className={styles.actions}>
      <div className={styles.buttons} role="group" aria-label={t('actions.label')}>
        {buttons}
      </div>
      {take.isError && <ActionError error={take.error} />}
      {dialog === 'reassign' && visitId !== undefined && <ReassignDialog ticketId={ticket.id} visitId={visitId} onClose={closeDialog} />}
      {dialog === 'close' && visitId !== undefined && <CloseDialog ticketId={ticket.id} visitId={visitId} onClose={closeDialog} />}
      {dialog === 'incident' && visitId !== undefined && <OpenIncidentDialog ticketId={ticket.id} visitId={visitId} onClose={closeDialog} />}
      {dialog === 'resolve' && incidentId !== undefined && <ResolveIncidentDialog ticketId={ticket.id} incidentId={incidentId} onClose={closeDialog} />}
    </div>
  );
}
