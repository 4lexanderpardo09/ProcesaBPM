import { pageResponseSchema, siteResponseSchema, subcategoryResponseSchema } from '@procesabpm/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { directoryNamesQueryOptions, PersonPicker, personName, tagsQueryOptions } from '@/features/profile';
import type { HttpClient } from '@/shared/api';
import { useApiClient, usePermissions } from '@/shared/session';
import { Button, Select, TextField } from '@/shared/ui';
import type { InboxFilters as Filters } from '../lib/inbox-params';
import { FieldInboxFilter } from './FieldInboxFilter';
import styles from './InboxFilters.module.css';

const subcategoriesQueryOptions = (client: HttpClient) =>
  queryOptions({
    queryKey: ['tickets', 'filter-subcategories'] as const,
    queryFn: ({ signal }) => client.request('/subcategories?pageSize=100&includeInactive=true', { schema: pageResponseSchema(subcategoryResponseSchema), signal }),
    select: (page) => page.items,
    staleTime: 5 * 60_000,
  });

const sitesQueryOptions = (client: HttpClient) =>
  queryOptions({
    queryKey: ['tickets', 'filter-sites'] as const,
    queryFn: ({ signal }) => client.request('/sites?pageSize=100&includeInactive=true', { schema: pageResponseSchema(siteResponseSchema), signal }),
    select: (page) => page.items,
    staleTime: 5 * 60_000,
  });

export interface MoreInboxFiltersProps {
  readonly filters: Filters;
  readonly onChange: (changed: Partial<Filters>) => void;
}

/**
 * The folded filters: subcategory (of the chosen category, if any), site, requester, current holder, one of the
 * person's own tags, the creation dates and the value of a field of the forms. Lists the role cannot read are left out.
 */
export function MoreInboxFilters({ filters, onChange }: MoreInboxFiltersProps) {
  const { t } = useTranslation('tickets');
  const client = useApiClient();
  const { can } = usePermissions();
  const subcategories = useQuery({ ...subcategoriesQueryOptions(client), enabled: can('read', 'Subcategory') });
  const sites = useQuery({ ...sitesQueryOptions(client), enabled: can('read', 'Site') });
  const tags = useQuery(tagsQueryOptions(client));
  const pick = (key: 'subcategoryId' | 'siteId' | 'tagId', value: string) => onChange({ [key]: value === '' ? undefined : value });
  const shownSubcategories = (subcategories.data ?? []).filter((subcategory) => filters.categoryId === undefined || subcategory.categoryId === filters.categoryId);

  return (
    <div className={styles.filters} role="group" aria-label={t('filters.more')}>
      {shownSubcategories.length > 0 && (
        <Select label={t('filters.subcategory')} placeholder={t('filters.any')} options={shownSubcategories.map((subcategory) => ({ value: subcategory.id, label: subcategory.name }))} value={filters.subcategoryId ?? ''} onChange={(event) => pick('subcategoryId', event.target.value)} />
      )}
      {sites.data !== undefined && sites.data.length > 0 && (
        <Select label={t('filters.site')} placeholder={t('filters.any')} options={sites.data.map((site) => ({ value: site.id, label: site.name }))} value={filters.siteId ?? ''} onChange={(event) => pick('siteId', event.target.value)} />
      )}
      {tags.data !== undefined && tags.data.length > 0 && (
        <Select label={t('filters.tag')} placeholder={t('filters.any')} options={tags.data.map((tag) => ({ value: tag.id, label: tag.name }))} value={filters.tagId ?? ''} onChange={(event) => pick('tagId', event.target.value)} />
      )}
      <TextField label={t('filters.createdFrom')} type="date" value={filters.createdFrom ?? ''} max={filters.createdTo} onChange={(event) => onChange({ createdFrom: event.target.value === '' ? undefined : event.target.value })} />
      <TextField label={t('filters.createdTo')} type="date" value={filters.createdTo ?? ''} min={filters.createdFrom} onChange={(event) => onChange({ createdTo: event.target.value === '' ? undefined : event.target.value })} />
      <PersonFilter label={t('filters.requester')} userId={filters.creatorId} onChange={(creatorId) => onChange({ creatorId })} />
      <PersonFilter label={t('filters.assignee')} userId={filters.assigneeId} onChange={(assigneeId) => onChange({ assigneeId })} />
      <FieldInboxFilter filters={filters} onChange={onChange} />
    </div>
  );
}

/** A person by name: searched in the directory, then shown with a way to take it off. */
function PersonFilter({ label, userId, onChange }: { readonly label: string; readonly userId: string | undefined; readonly onChange: (userId: string | undefined) => void }) {
  const { t } = useTranslation('tickets');
  const names = useQuery(directoryNamesQueryOptions(useApiClient(), userId === undefined ? [] : [userId]));
  if (userId === undefined) {
    return (
      <div className={styles.person}>
        <PersonPicker label={label} actionLabel={t('filters.choose')} actionLabelNamed={(name) => t('filters.chooseNamed', { name, filter: label })} onPick={(person) => onChange(person.userId)} />
      </div>
    );
  }
  const person = names.data?.find((candidate) => candidate.userId === userId);
  const name = person === undefined ? t('filters.someone') : personName(person);
  return (
    <div className={styles.person}>
      <span className={styles.chosenLabel}>{label}</span>
      <span className={styles.chosen}>
        {name}
        <Button variant="ghost" aria-label={t('filters.removeNamed', { name, filter: label })} onClick={() => onChange(undefined)}>
          {t('filters.remove')}
        </Button>
      </span>
    </div>
  );
}
