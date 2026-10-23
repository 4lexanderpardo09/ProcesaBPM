import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { paths } from '@/shared/lib/paths';
import { Alert, Breadcrumb, Card, PageHeader, Select } from '@/shared/ui';
import { availableCatalogQueryOptions, creationFormQueryOptions, prioritiesQueryOptions } from '../api/new-ticket-api';
import { CreationError } from '../components/new/CreationError';
import { RequestForm } from '../components/new/RequestForm';
import { type Requester, RequesterCard } from '../components/new/RequesterCard';
import { RequestSummary } from '../components/new/RequestSummary';
import { type RequestType, RequestTypeCard, SectionTitle } from '../components/new/RequestTypeCard';
import styles from '../components/new/NewTicket.module.css';

const NO_TYPE: RequestType = { companyId: '', categoryId: '', subcategoryId: '', priorityId: undefined };

/**
 * A new ticket: for whom (oneself, or someone else with `create_for_others`), the company (when that person is in
 * several), the category and subcategory that decide the workflow, the priority, and then the data its START block asks
 * for. The catalog and the form are the requester's. The summary on the side follows the choices.
 */
export function NewTicketPage() {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const me = useCurrentUser().data;
  const { can, loaded } = usePermissions();
  // Until the permissions arrive, the page assumes the usual case: a ticket for oneself.
  const canForSelf = !loaded || can('create', 'Ticket');
  const canForOthers = can('create_for_others', 'Ticket');
  const [requester, setRequester] = useState<Requester>();
  const forOther = requester !== undefined;
  const requesterId = requester?.userId ?? '';
  const [type, setType] = useState<RequestType>(NO_TYPE);
  const [startId, setStartId] = useState<string>();
  // Someone else's companies come with their catalog; one's own, with the session.
  const theirs = useQuery({ ...availableCatalogQueryOptions(client, '', requesterId), enabled: forOther });
  const companies = forOther ? (theirs.data?.companies ?? []) : (me?.membership.companies ?? []);
  const ownDefault = me?.membership.companies.find((company) => company.isDefault)?.id;
  const companyId = type.companyId !== '' ? type.companyId : (forOther ? companies[0]?.id : (ownDefault ?? companies[0]?.id)) ?? '';
  const catalog = useQuery({ ...availableCatalogQueryOptions(client, companyId, requesterId), enabled: companyId !== '' && (canForSelf || forOther) });
  const priorities = useQuery(prioritiesQueryOptions(client));
  const form = useQuery({ ...creationFormQueryOptions(client, type.subcategoryId, companyId, requesterId), enabled: type.subcategoryId !== '' && companyId !== '' });
  const chooseRequester = (next: Requester | undefined) => {
    setRequester(next);
    setType(NO_TYPE);
    setStartId(undefined);
  };
  const waitingForRequester = !canForSelf && !forOther;

  const category = catalog.data?.categories.find((candidate) => candidate.id === type.categoryId);
  const subcategory = category?.subcategories.find((candidate) => candidate.id === type.subcategoryId);
  const start = form.data?.starts.find((candidate) => candidate.stepId === startId) ?? form.data?.starts[0];
  const priorityId = type.priorityId ?? form.data?.defaultPriorityId ?? subcategory?.defaultPriorityId ?? null;
  const priority = priorities.data?.find((candidate) => candidate.id === priorityId);

  return (
    <>
      <div className={styles.crumbs}>
        <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('inbox.title'), to: paths.tickets }, { label: t('new.title') }]} />
      </div>
      <PageHeader title={t('new.title')} subtitle={t('new.subtitle')} />
      {canForOthers && me !== undefined && (
        <div className={styles.requesterRow}>
          <RequesterCard requester={requester} canCreateForSelf={canForSelf} selfId={me.user.id} onChange={chooseRequester} />
        </div>
      )}
      {waitingForRequester ? null : forOther && theirs.isError ? (
        <CreationError error={theirs.error} />
      ) : forOther && theirs.data === undefined ? (
        <p className={styles.note}>{t('new.data.loading')}</p>
      ) : companies.length === 0 ? (
        <Alert tone="warn">{forOther ? t('new.requester.noCompany') : t('new.noCompany')}</Alert>
      ) : (
        <div className={styles.columns}>
          <div className={styles.main}>
            <RequestTypeCard
              companies={companies}
              categories={catalog.data?.categories}
              catalogFailed={catalog.isError}
              recent={catalog.data?.recent ?? []}
              priorities={priorities.data ?? []}
              priorityId={priorityId}
              value={{ ...type, companyId }}
              onChange={(next) => {
                setType(next);
                setStartId(undefined);
              }}
            />
            {type.subcategoryId === '' ? (
              <Card title={<SectionTitle number={2} title={t('new.data.title')} />}>
                <p className={styles.note}>{t('new.data.chooseFirst')}</p>
              </Card>
            ) : form.isError ? (
              <Card title={<SectionTitle number={2} title={t('new.data.title')} />}>
                <CreationError error={form.error} />
              </Card>
            ) : form.data === undefined || start === undefined ? (
              <Card title={<SectionTitle number={2} title={t('new.data.title')} />}>
                <p className={styles.note}>{t('new.data.loading')}</p>
              </Card>
            ) : (
              <>
                {form.data.starts.length > 1 && (
                  <Card>
                    <Select
                      label={t('new.data.start')}
                      hint={t('new.data.startHint')}
                      value={start.stepId}
                      options={form.data.starts.map((candidate) => ({ value: candidate.stepId, label: candidate.name }))}
                      onChange={(event) => setStartId(event.target.value)}
                    />
                  </Card>
                )}
                <RequestForm key={`${requesterId}:${companyId}:${type.subcategoryId}:${start.stepId}`} subcategoryId={type.subcategoryId} companyId={companyId} requesterId={forOther ? requesterId : undefined} priorityId={type.priorityId} start={start} />
              </>
            )}
          </div>
          <aside className={styles.side}>
            <RequestSummary
              requester={requester?.name}
              company={companies.find((company) => company.id === companyId)?.name}
              category={category?.name}
              subcategory={subcategory?.name}
              subcategoryDescription={subcategory?.description}
              priority={priority?.name}
              firstStep={start?.name}
            />
          </aside>
        </div>
      )}
    </>
  );
}
