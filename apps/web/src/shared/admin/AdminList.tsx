import { useQuery } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { z } from 'zod';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Checkbox, Pagination, PlusIcon, Table, type TableColumn, TextField } from '@/shared/ui';
import { ADMIN_PAGE_SIZE, adminListQueryOptions, setAdminItemActive } from './admin-api';
import { useAdminMutation } from './use-admin-mutation';
import { AdminError } from './AdminError';
import styles from './Admin.module.css';

/** The search waits for the person to pause before asking the API. */
const SEARCH_DELAY_MS = 300;

interface AdminRow {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface AdminListProps<TSchema extends z.ZodType<AdminRow>> {
  /** Names the table for screen readers. */
  readonly label: string;
  readonly path: string;
  readonly item: TSchema;
  readonly filter?: Readonly<Record<string, string>>;
  readonly columns: readonly TableColumn<z.infer<TSchema>>[];
  readonly empty: string;
  /** The "Nueva …" button, when the role may create. */
  readonly create?: { readonly label: string; readonly onClick: () => void };
  /** Edit, when the role may edit. */
  readonly onEdit?: (row: z.infer<TSchema>) => void;
  /** Activate and deactivate, when the role may. */
  readonly canToggle: boolean;
  /** Something more per row (the subcategories of a category). */
  readonly rowAction?: (row: z.infer<TSchema>) => ReactNode;
  /** What other screens cache from this data, read again after a change. */
  readonly alsoInvalidates?: readonly QueryKey[];
}

/**
 * One list of the catalog: search by name, the deactivated ones on request, a page at a time, and the actions the role
 * allows. Deactivating is the API's "delete": the record stays for what already uses it but is no longer offered.
 */
export function AdminList<TSchema extends z.ZodType<AdminRow>>({ label, path, item, filter, columns, empty, create, onEdit, canToggle, rowAction, alsoInvalidates = [] }: AdminListProps<TSchema>) {
  const { t } = useTranslation('admin');
  const [search, setSearch] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [page, setPage] = useState(1);
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const list = useQuery(adminListQueryOptions(useApiClient(), path, item, { page, search: settled, includeInactive, ...(filter === undefined ? {} : { filter }) }));
  const toggle = useAdminMutation((client, row: AdminRow) => setAdminItemActive(client, path, row.id, !row.isActive), alsoInvalidates);
  type Row = z.infer<TSchema>;

  const statusColumn: TableColumn<Row> = {
    key: 'status',
    header: t('list.status'),
    width: '110px',
    cell: (row) => (row.isActive ? <Badge tone="ok">{t('list.active')}</Badge> : <Badge>{t('list.inactive')}</Badge>),
  };
  const hasActions = onEdit !== undefined || canToggle || rowAction !== undefined;
  const actionsColumn: TableColumn<Row> = {
    key: 'actions',
    header: t('list.actions'),
    cell: (row) => (
      <div className={styles.rowActions}>
        {rowAction?.(row)}
        {onEdit !== undefined && (
          <Button variant="ghost" aria-label={t('list.editNamed', { name: row.name })} onClick={() => onEdit(row)}>
            {t('list.edit')}
          </Button>
        )}
        {canToggle && (
          <Button variant="ghost" aria-label={t(row.isActive ? 'list.deactivateNamed' : 'list.activateNamed', { name: row.name })} disabled={toggle.isPending} onClick={() => toggle.mutate(row)}>
            {row.isActive ? t('list.deactivate') : t('list.activate')}
          </Button>
        )}
      </div>
    ),
  };

  return (
    <div className={styles.list}>
      <div className={styles.toolbar}>
        <div className={styles.search}>
          <TextField
            label={t('list.search')}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Checkbox
          label={t('list.showInactive')}
          checked={includeInactive}
          onChange={(event) => {
            setIncludeInactive(event.target.checked);
            setPage(1);
          }}
        />
        {create !== undefined && (
          <div className={styles.toolbarEnd}>
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={create.onClick}>
              {create.label}
            </Button>
          </div>
        )}
      </div>
      <AdminError error={toggle.error} />
      <Table
        label={label}
        columns={[...columns, statusColumn, ...(hasActions ? [actionsColumn] : [])]}
        rows={list.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={list.data === undefined && !list.isError}
        loadingLabel={t('list.loading')}
        empty={list.isError ? t('list.failed') : settled !== '' ? t('list.noMatches') : empty}
        footer={list.data !== undefined && list.data.total > ADMIN_PAGE_SIZE ? <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={list.data.total} onChange={setPage} /> : undefined}
      />
    </div>
  );
}
