import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { paths } from '@/shared/lib/paths';
import { Alert, Breadcrumb, Card, PageHeader, Select } from '@/shared/ui';
import { availableCatalogQueryOptions, creationFormQueryOptions, prioritiesQueryOptions } from '../api/new-ticket-api';
import { CreationError } from '../components/new/CreationError';
import { RequestForm } from '../components/new/RequestForm';
import { RequestSummary } from '../components/new/RequestSummary';
import { type RequestType, RequestTypeCard, SectionTitle } from '../components/new/RequestTypeCard';
import styles from '../components/new/NewTicket.module.css';

const NO_TYPE: RequestType = { companyId: '', categoryId: '', subcategoryId: '', priorityId: undefined };

/**
 * A new ticket for oneself: the company (when the person is in several), the category and subcategory that decide the
 * workflow, the priority, and then the data its START block asks for. The summary on the side follows the choices.
 */
export function NewTicketPage() {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const companies = useCurrentUser().data?.membership.companies ?? [];
  const [type, setType] = useState<RequestType>(NO_TYPE);
  const [startId, setStartId] = useState<string>();
  const companyId = type.companyId !== '' ? type.companyId : (companies.find((company) => company.isDefault) ?? companies[0])?.id ?? '';
  const catalog = useQuery({ ...availableCatalogQueryOptions(client, companyId), enabled: companyId !== '' });
  const priorities = useQuery(prioritiesQueryOptions(client));
  const form = useQuery({ ...creationFormQueryOptions(client, type.subcategoryId, companyId), enabled: type.subcategoryId !== '' && companyId !== '' });

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
      {companies.length === 0 ? (
        <Alert tone="warn">{t('new.noCompany')}</Alert>
      ) : (
        <div className={styles.columns}>
          <div className={styles.main}>
            <RequestTypeCard
              companies={companies}
              categories={catalog.data?.categories}
              catalogFailed={catalog.isError}
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
                <RequestForm key={`${companyId}:${type.subcategoryId}:${start.stepId}`} subcategoryId={type.subcategoryId} companyId={companyId} priorityId={type.priorityId} start={start} />
              </>
            )}
          </div>
          <aside className={styles.side}>
            <RequestSummary
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
