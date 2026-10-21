import { type ErrorSubtypeResponse, errorSubtypeResponseSchema, type ErrorTypeResponse, errorTypeResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePermissions } from '@/shared/session';
import { Badge, Button, Card } from '@/shared/ui';
import { AdminList } from '@/shared/admin/AdminList';
import { ErrorSubtypeDialog } from './ErrorSubtypeDialog';
import { ErrorTypeDialog } from './ErrorTypeDialog';
import styles from '../Catalog.module.css';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';

type Editing<T> = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly record: T } | null;

/** What a reopening or an error report is filed under, and how it counts. */
export function ErrorTypesTab() {
  const { t } = useTranslation(['catalog', 'admin']);
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing<ErrorTypeResponse>>(null);
  const [selected, setSelected] = useState<ErrorTypeResponse>();
  return (
    <div className={styles.stack}>
      <AdminList
        alsoInvalidates={CATALOG_DEPENDENTS}
        label={t('errorTypes.title')}
        path="/error-types"
        item={errorTypeResponseSchema}
        columns={[
          { key: 'name', header: t('admin:fields.name'), cell: (row) => row.name },
          {
            key: 'kind',
            header: t('errorTypes.kind'),
            cell: (row) => (
              <span className={styles.badges}>
                {row.isReopening && <Badge tone="accent">{t('errorTypes.reopening')}</Badge>}
                {row.forcesClose && <Badge tone="warn">{t('errorTypes.forcesClose')}</Badge>}
                {row.isProcessError && <Badge tone="violet">{t('errorTypes.processError')}</Badge>}
                {!row.isReopening && !row.forcesClose && !row.isProcessError && '—'}
              </span>
            ),
          },
        ]}
        empty={t('errorTypes.empty')}
        {...(can('create', 'ErrorType') ? { create: { label: t('errorTypes.new'), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', 'ErrorType') ? { onEdit: (record: ErrorTypeResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'ErrorType') && can('delete', 'ErrorType')}
        rowAction={(row) => (
          <Button variant="ghost" aria-pressed={selected?.id === row.id} aria-label={t('errorTypes.subtypesOf', { name: row.name })} onClick={() => setSelected(selected?.id === row.id ? undefined : row)}>
            {t('errorTypes.subtypes')}
          </Button>
        )}
      />
      {selected !== undefined && <SubtypesPanel key={selected.id} errorType={selected} />}
      {editing !== null && <ErrorTypeDialog record={editing.mode === 'edit' ? editing.record : undefined} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SubtypesPanel({ errorType }: { readonly errorType: ErrorTypeResponse }) {
  const { t } = useTranslation(['catalog', 'admin']);
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing<ErrorSubtypeResponse>>(null);
  const path = `/error-types/${encodeURIComponent(errorType.id)}/subtypes`;
  // Subtypes are part of their type: the type's own permissions apply (create, update, delete).
  return (
    <Card title={t('errorSubtypes.title', { type: errorType.name })}>
      <AdminList
        alsoInvalidates={CATALOG_DEPENDENTS}
        label={t('errorSubtypes.tableLabel', { type: errorType.name })}
        path={path}
        item={errorSubtypeResponseSchema}
        columns={[
          { key: 'name', header: t('admin:fields.name'), cell: (row) => row.name },
          { key: 'description', header: t('admin:fields.description'), cell: (row) => row.description ?? '—' },
        ]}
        empty={t('errorSubtypes.empty')}
        {...(can('create', 'ErrorType') ? { create: { label: t('errorSubtypes.new'), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', 'ErrorType') ? { onEdit: (record: ErrorSubtypeResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'ErrorType') && can('delete', 'ErrorType')}
      />
      {editing !== null && <ErrorSubtypeDialog path={path} record={editing.mode === 'edit' ? editing.record : undefined} onClose={() => setEditing(null)} />}
    </Card>
  );
}
