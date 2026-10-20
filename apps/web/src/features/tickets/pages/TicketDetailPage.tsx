import type { TicketDetailResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';
import { ApiError } from '@/shared/api';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { paths } from '@/shared/lib/paths';
import { useCurrentUser } from '@/shared/session';
import { Alert, ButtonLink, Card, PageHeader, RichText } from '@/shared/ui';
import { LoadError } from '../components/LoadError';
import { TicketActivity } from '../components/TicketActivity';
import { TicketAttachments } from '../components/TicketAttachments';
import { TicketDetailHeader } from '../components/TicketDetailHeader';
import { TicketFacts } from '../components/TicketFacts';
import { TicketFieldValues } from '../components/TicketFieldValues';
import { TicketFlow } from '../components/flow/TicketFlow';
import { useTicketDetail } from '../hooks/use-ticket-detail';
import { slaBadge } from '../lib/sla-badge';
import styles from './TicketDetailPage.module.css';

const NOT_FOUND = 404;

/** One ticket: its facts, its progress through the workflow, description, activity with comments, captured values and attachments. */
export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const { t } = useTranslation('tickets');
  const { detail, form, timeline, documents, flow } = useTicketDetail(ticketId);
  const user = useCurrentUser().data?.user;
  const timeZone = user?.timeZone ?? undefined;

  if (detail.isError) return <DetailError detail={detail} />;
  const ticket = detail.data;
  if (ticket === undefined) return <p className={styles.muted}>{t('detail.loading')}</p>;

  return (
    <>
      <TicketDetailHeader ticket={ticket} sla={ticket.status === 'CLOSED' ? undefined : slaBadge(ticket.sla, new Date())} />
      <TicketFacts ticket={ticket} userId={user?.id} timeZone={timeZone} />
      <TicketNotices ticket={ticket} userId={user?.id} timeZone={timeZone} />
      <div className={styles.flow}>
        <TicketFlow flow={flow} />
      </div>
      <div className={styles.columns}>
        <div className={styles.main}>
          <Card title={t('detail.description.title')}>
            {ticket.descriptionHtml === '' ? <p className={styles.muted}>{t('detail.description.empty')}</p> : <RichText html={ticket.descriptionHtml} />}
          </Card>
          <TicketActivity ticketId={ticket.id} timeline={timeline} timeZone={timeZone} />
        </div>
        <aside className={styles.side}>
          <TicketFieldValues values={ticket.values} valueNames={ticket.valueNames} form={form} timeZone={timeZone} />
          <TicketAttachments ticketId={ticket.id} documents={documents} timeZone={timeZone} />
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
