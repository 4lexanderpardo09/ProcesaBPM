import { categoryResponseSchema, pageResponseSchema } from '@procesabpm/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HttpClient } from '@/shared/api';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { Button, Checkbox, Select, TextField } from '@/shared/ui';
import { prioritiesQueryOptions } from '../api/new-ticket-api';
import { hasFilters, type InboxFilters as Filters, MORE_FILTERS, NO_FILTERS, TICKET_STATUSES, type TicketStatus } from '../lib/inbox-params';
import { MoreInboxFilters } from './MoreInboxFilters';
import styles from './InboxFilters.module.css';

const SEARCH_DELAY_MS = 300;

const categoriesQueryOptions = (client: HttpClient) =>
  queryOptions({
    queryKey: ['tickets', 'filter-categories'] as const,
    queryFn: ({ signal }) => client.request('/categories?pageSize=100&includeInactive=true', { schema: pageResponseSchema(categoryResponseSchema), signal }),
    select: (page) => page.items,
    staleTime: 5 * 60_000,
  });

export interface InboxFiltersProps {
  readonly filters: Filters;
  /** Only what changed: the page merges it into the URL as it is then, so two quick changes never undo each other. */
  readonly onChange: (changed: Partial<Filters>) => void;
}

/**
 * Search (number, title or requester), status, priority, category and company. A list only shows when the person can
 * read it; the companies are their own, and only when they belong to more than one.
 */
export function InboxFilters({ filters, onChange }: InboxFiltersProps) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const { can } = usePermissions();
  const companies = useCurrentUser().data?.membership.companies ?? [];
  const priorities = useQuery({ ...prioritiesQueryOptions(client), enabled: can('read', 'Priority') });
  const categories = useQuery({ ...categoriesQueryOptions(client), enabled: can('read', 'Category') });
  const [search, setSearch] = useState(filters.search);
  // Opens by itself when the URL already carries one of the folded filters.
  const [more, setMore] = useState(() => MORE_FILTERS.some((key) => filters[key] !== undefined));
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  // The search this box last sent to the URL: a change of the URL to anything else came from elsewhere (back, clear).
  const sent = useRef(filters.search);
  useEffect(() => {
    if (settled === filters.search) return;
    sent.current = settled;
    onChange({ search: settled });
  }, [settled]);
  useEffect(() => {
    if (filters.search === sent.current) return;
    sent.current = filters.search;
    setSearch(filters.search);
  }, [filters.search]);

  const pick = (key: 'priorityId' | 'workflowPriorityId' | 'categoryId' | 'companyId', value: string) => onChange({ [key]: value === '' ? undefined : value });
  return (
    <div className={styles.panel} role="search" aria-label={t('filters.label')}>
      <div className={styles.filters}>
        <div className={styles.search}>
          <TextField label={t('filters.search')} type="search" placeholder={t('filters.searchPlaceholder')} value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} />
          <Checkbox label={t('filters.searchMessages')} checked={filters.searchMessages} onChange={(event) => onChange({ searchMessages: event.target.checked })} />
        </div>
        <Select
          label={t('filters.status')}
          placeholder={t('filters.anyStatus')}
          options={TICKET_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
          value={filters.status ?? ''}
          onChange={(event) => onChange({ status: TICKET_STATUSES.find((value) => value === event.target.value) as TicketStatus | undefined })}
        />
        {priorities.data !== undefined && priorities.data.length > 0 && (
          <>
            <Select label={t('filters.priority')} placeholder={t('filters.any')} options={priorities.data.map((priority) => ({ value: priority.id, label: priority.name }))} value={filters.priorityId ?? ''} onChange={(event) => pick('priorityId', event.target.value)} />
            <Select label={t('filters.workflowPriority')} placeholder={t('filters.any')} options={priorities.data.map((priority) => ({ value: priority.id, label: priority.name }))} value={filters.workflowPriorityId ?? ''} onChange={(event) => pick('workflowPriorityId', event.target.value)} />
          </>
        )}
        {categories.data !== undefined && categories.data.length > 0 && (
          <Select label={t('filters.category')} placeholder={t('filters.any')} options={categories.data.map((category) => ({ value: category.id, label: category.name }))} value={filters.categoryId ?? ''} onChange={(event) => pick('categoryId', event.target.value)} />
        )}
        {companies.length > 1 && (
          <Select label={t('filters.company')} placeholder={t('filters.any')} options={companies.map((company) => ({ value: company.id, label: company.name }))} value={filters.companyId ?? ''} onChange={(event) => pick('companyId', event.target.value)} />
        )}
        <div className={styles.toggle}>
          <Button variant="ghost" aria-expanded={more} onClick={() => setMore((open) => !open)}>
            {more ? t('filters.less') : t('filters.moreOpen')}
          </Button>
        </div>
        {hasFilters(filters) && (
          <Button
            variant="ghost"
            onClick={() => {
              sent.current = '';
              setSearch('');
              onChange(NO_FILTERS);
            }}
          >
            {t('filters.clear')}
          </Button>
        )}
      </div>
      {more && <MoreInboxFilters filters={filters} onChange={onChange} />}
    </div>
  );
}
