import type { TicketDetailResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { paths } from '@/shared/lib/paths';
import { useCurrentUser } from '@/shared/session';
import { Alert, Button, ButtonLink, Card, PageHeader, RichText } from '@/shared/ui';
import { LoadError } from '../components/LoadError';
import { TicketActivity } from '../components/TicketActivity';
import { TicketAttachments } from '../components/TicketAttachments';
import { TicketDetailHeader } from '../components/TicketDetailHeader';
import { TicketFacts } from '../components/TicketFacts';
import { TicketFieldValues } from '../components/TicketFieldValues';
import { TicketParallelSignatures } from '../components/TicketParallelSignatures';
import { TicketStepFiles } from '../components/TicketStepFiles';
import { TicketStepInstructions } from '../components/TicketStepInstructions';
import { TicketStepTimes } from '../components/TicketStepTimes';
import { TicketTagsCard } from '../components/TicketTagsCard';
import { TicketActions } from '../components/actions/TicketActions';
import { TicketFlow } from '../components/flow/TicketFlow';
import { useTicketDetail } from '../hooks/use-ticket-detail';
import { slaBadge } from '../lib/sla-badge';
import styles from './TicketDetailPage.module.css';

const NOT_FOUND = 404;

/** One ticket: its facts, its progress through the workflow, the current step's instructions, description, activity with comments, the signatures of a parallel step, the step's support files, captured values, attachments and the caller's tags. */
export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const { t } = useTranslation('tickets');
  const { detail, form, timeline, documents, flow, stepFiles } = useTicketDetail(ticketId);
  const user = useCurrentUser().data?.user;
  const timeZone = user?.timeZone ?? undefined;

  if (detail.isError) return <DetailError detail={detail} />;
  const ticket = detail.data;
  if (ticket === undefined) return <p className={styles.muted}>{t('detail.loading')}</p>;

  return (
    <>
      <TicketDetailHeader ticket={ticket} sla={ticket.status === 'CLOSED' ? undefined : slaBadge(ticket.sla, new Date())} actions={
          <div className={styles.headerActions} data-print="hide">
            <Button variant="ghost" onClick={() => window.print()}>
              {t('detail.print')}
            </Button>
            <TicketActions ticket={ticket} form={form.data} />
          </div>
        }
      />
      <TicketFacts ticket={ticket} userId={user?.id} timeZone={timeZone} />
      <TicketNotices ticket={ticket} userId={user?.id} timeZone={timeZone} />
      <div className={styles.flow}>
        <TicketFlow flow={flow} />
      </div>
      <div className={styles.columns}>
        <div className={styles.main}>
          {ticket.status !== 'CLOSED' && <TicketStepInstructions form={form.data} />}
          <Card title={t('detail.description.title')}>
            {ticket.descriptionHtml === '' ? <p className={styles.muted}>{t('detail.description.empty')}</p> : <RichText html={ticket.descriptionHtml} />}
          </Card>
          <TicketActivity ticketId={ticket.id} timeline={timeline} canComment={ticket.actions.comment} closed={ticket.status === 'CLOSED'} timeZone={timeZone} fields={form.data?.fields ?? []} valueNames={ticket.valueNames} documents={documents.data ?? []} />
        </div>
        <aside className={styles.side}>
          <TicketParallelSignatures tasks={ticket.parallelTasks} timeZone={timeZone} />
          <TicketStepFiles ticketId={ticket.id} stepFiles={stepFiles} />
          <TicketFieldValues
            ticketId={ticket.id}
            values={ticket.values}
            valueNames={ticket.valueNames}
            totals={ticket.totals}
            fileNames={Object.fromEntries((documents.data ?? []).map((document) => [document.file.id, document.file.name]))}
            form={form}
            timeZone={timeZone}
            canEdit={ticket.actions.edit}
          />
          <TicketAttachments ticketId={ticket.id} number={ticket.number} documents={documents} timeZone={timeZone} />
          <TicketStepTimes flow={flow} timeZone={timeZone} />
          <TicketTagsCard ticket={ticket} />
        </aside>
      </div>
    </>
  );
}

interface TicketNoticesProps {
  readonly ticket: TicketDetailResponse;
  readonly userId: string | undefined;
  readonly timeZone: string | undefined;
}

/** Why nobody can move the ticket right now: an open incident, or a wait block until a date. */
function TicketNotices({ ticket, userId, timeZone }: TicketNoticesProps) {
  const { t } = useTranslation('tickets');
  const incident = ticket.openIncident;
  if (incident === null && ticket.waitingUntil === null) return null;
  return (
    <div className={styles.notices}>
      {incident !== null && (
        <Alert tone="warn" title={t('detail.incident.title')}>
          <RichText html={incident.descriptionHtml} />
          <p className={styles.notice}>{incident.assignedTo.id === userId ? t('detail.incident.forYou') : t('detail.incident.assignedTo', { name: incident.assignedTo.name })}</p>
        </Alert>
      )}
      {ticket.waitingUntil !== null && <Alert tone="info">{t('detail.waitingUntil', { date: formatDateTime(ticket.waitingUntil, timeZone) })}</Alert>}
    </div>
  );
}

function DetailError({ detail }: { readonly detail: UseQueryResult<TicketDetailResponse> }) {
  const { t } = useTranslation('tickets');
  if (detail.error instanceof ApiError && detail.error.status === NOT_FOUND) {
    return (
      <PageHeader
        title={t('detail.notFound.title')}
        subtitle={t('detail.notFound.body')}
        actions={<ButtonLink to={paths.tickets}>{t('detail.notFound.back')}</ButtonLink>}
      />
    );
  }
  return <LoadError error={detail.error} onRetry={() => void detail.refetch()} />;
}
