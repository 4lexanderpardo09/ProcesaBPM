import { type PriorityResponse, priorityResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/shared/session';
import { CatalogList } from '../CatalogList';
import { PriorityDialog } from './PriorityDialog';
import styles from '../Catalog.module.css';

type Editing = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly record: PriorityResponse } | null;

/** The priorities a ticket can have, in the order they are offered. */
export function PrioritiesTab() {
  const { t } = useTranslation('catalog');
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <>
      <CatalogList
        label={t('priorities.title')}
        path="/priorities"
        item={priorityResponseSchema}
        columns={[
          { key: 'name', header: t('fields.name'), cell: (row) => row.name },
          { key: 'order', header: t('priorities.order'), width: '90px', code: true, cell: (row) => row.sortOrder },
          {
            key: 'color',
            header: t('priorities.color'),
            width: '140px',
            cell: (row) =>
              row.color === null ? (
                '—'
              ) : (
                <span className={styles.color}>
                  {/* The priority's own color is data the organization chose, not a design token. */}
                  <span className={styles.swatch} style={{ background: row.color }} aria-hidden="true" />
                  <span className="text-code">{row.color}</span>
                </span>
              ),
          },
        ]}
        empty={t('priorities.empty')}
        {...(can('create', 'Priority') ? { create: { label: t('priorities.new'), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', 'Priority') ? { onEdit: (record: PriorityResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'Priority') && can('delete', 'Priority')}
      />
      {editing !== null && <PriorityDialog record={editing.mode === 'edit' ? editing.record : undefined} onClose={() => setEditing(null)} />}
    </>
  );
}
