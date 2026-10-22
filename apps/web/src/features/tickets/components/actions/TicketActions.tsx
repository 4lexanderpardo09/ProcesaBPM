import type { FormDecisionResponse, TicketDetailResponse, TicketFormResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { takeTicket } from '../../api/ticket-actions-api';
import { useTicketMutation } from '../../hooks/use-ticket-mutation';
import { AdvanceDialog } from '../advance/AdvanceDialog';
import { ActionError } from './ActionError';
import { CloseDialog } from './CloseDialog';
import { EditTicketDialog } from './EditTicketDialog';
import { OpenIncidentDialog } from './OpenIncidentDialog';
import { type ParallelAnswer, ParallelTaskDialog } from './ParallelTaskDialog';
import { ReassignDialog } from './ReassignDialog';
import { ReopenDialog } from './ReopenDialog';
import { ResolveIncidentDialog } from './ResolveIncidentDialog';
import styles from './TicketActions.module.css';

type OpenDialog = 'edit' | 'reassign' | 'close' | 'incident' | 'resolve' | 'reopen' | { readonly parallel: ParallelAnswer } | { readonly decision: FormDecisionResponse };

export interface TicketActionsProps {
  readonly ticket: TicketDetailResponse;
  /** The current step and its decisions; `undefined` while it loads. */
  readonly form: TicketFormResponse | undefined;
}

/**
 * The actions the API says the person may take now (`actions`); each one that needs input opens its dialog. The step's
 * decisions come first: the only one is the screen's main action, several stay side by side with the same weight.
 */
export function TicketActions({ ticket, form }: TicketActionsProps) {
  const { t } = useTranslation('tickets');
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const take = useTicketMutation((client, visitId: string) => takeTicket(client, ticket.id, visitId));
  const { actions } = ticket;
  const visitId = ticket.openVisit?.id;
  const incidentId = ticket.openIncident?.id;
  const closeDialog = () => setDialog(null);

  const onVisit = visitId !== undefined;
  const decisions = actions.advance && onVisit ? (form?.decisions ?? []) : [];
  const buttons = [
    ...decisions.map((decision) => (
      <Button key={decision.transitionId} variant={decisions.length === 1 ? 'primary' : 'secondary'} onClick={() => setDialog({ decision })}>
        {decision.label}
      </Button>
    )),
    ...(actions.signParallelTask && onVisit
      ? [
          <Button key="sign" variant="primary" onClick={() => setDialog({ parallel: 'sign' })}>{t('actions.parallel.sign.open')}</Button>,
          <Button key="reject" onClick={() => setDialog({ parallel: 'reject' })}>{t('actions.parallel.reject.open')}</Button>,
        ]
      : []),
    actions.resolveIncident && incidentId !== undefined && <Button key="resolve" variant="primary" onClick={() => setDialog('resolve')}>{t('actions.resolve.open')}</Button>,
    actions.take && onVisit && (
      <Button key="take" variant="primary" disabled={take.isPending} onClick={() => take.mutate(visitId)}>
        {take.isPending ? t('actions.sending') : t('actions.take')}
      </Button>
    ),
    actions.reassign && onVisit && <Button key="reassign" onClick={() => setDialog('reassign')}>{t('actions.reassign.open')}</Button>,
    actions.openIncident && onVisit && <Button key="incident" onClick={() => setDialog('incident')}>{t('actions.incident.open')}</Button>,
    actions.close && onVisit && <Button key="close" onClick={() => setDialog('close')}>{t('actions.close.open')}</Button>,
    actions.reopen && <Button key="reopen" variant="primary" onClick={() => setDialog('reopen')}>{t('actions.reopen.open')}</Button>,
    actions.edit && <Button key="edit" onClick={() => setDialog('edit')}>{t('actions.edit.open')}</Button>,
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
      {typeof dialog === 'object' && dialog !== null && 'parallel' in dialog && visitId !== undefined && (
        <ParallelTaskDialog ticketId={ticket.id} visitId={visitId} answer={dialog.parallel} onClose={closeDialog} />
      )}
      {dialog === 'edit' && <EditTicketDialog ticket={ticket} onClose={closeDialog} />}
      {dialog === 'reopen' && <ReopenDialog ticketId={ticket.id} onClose={closeDialog} />}
      {typeof dialog === 'object' && dialog !== null && 'decision' in dialog && form !== undefined && visitId !== undefined && (
        <AdvanceDialog ticket={ticket} form={form} visitId={visitId} decision={dialog.decision} onClose={closeDialog} />
      )}
      {dialog === 'resolve' && incidentId !== undefined && <ResolveIncidentDialog ticketId={ticket.id} incidentId={incidentId} onClose={closeDialog} />}
    </div>
  );
}
