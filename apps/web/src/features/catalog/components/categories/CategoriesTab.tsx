import { type CategoryResponse, categoryResponseSchema, type SubcategoryResponse, subcategoryResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient, usePermissions } from '@/shared/session';
import { Button, Card } from '@/shared/ui';
import { activePrioritiesQueryOptions } from '../../api/priorities-api';
import { AdminList } from '@/shared/admin/AdminList';
import { CategoryDialog } from './CategoryDialog';
import { SubcategoryDialog } from './SubcategoryDialog';
import { VisibilityDialog } from './VisibilityDialog';
import styles from '../Catalog.module.css';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';

type Editing<T> = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly record: T } | null;

/** Categories group the subcategories; a subcategory is what a ticket is opened as, and its workflow hangs from it. */
export function CategoriesTab() {
  const { t } = useTranslation(['catalog', 'admin']);
  const { can } = usePermissions();
  const [category, setCategory] = useState<Editing<CategoryResponse>>(null);
  const [selected, setSelected] = useState<CategoryResponse>();
  const [visibility, setVisibility] = useState<CategoryResponse>();
  return (
    <div className={styles.stack}>
      <AdminList
        alsoInvalidates={CATALOG_DEPENDENTS}
        label={t('categories.title')}
        path="/categories"
        item={categoryResponseSchema}
        columns={[{ key: 'name', header: t('admin:fields.name'), cell: (row) => row.name }]}
        empty={t('categories.empty')}
        {...(can('create', 'Category') ? { create: { label: t('categories.new'), onClick: () => setCategory({ mode: 'create' }) } } : {})}
        {...(can('update', 'Category') ? { onEdit: (record: CategoryResponse) => setCategory({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'Category') && can('delete', 'Category')}
        rowAction={(row) =>
          can('update', 'Category') || can('read', 'Subcategory') ? (
            <>
              {can('update', 'Category') && (
                <Button variant="ghost" aria-label={t('catalog:visibility.open', { name: row.name })} onClick={() => setVisibility(row)}>
                  {t('catalog:visibility.button')}
                </Button>
              )}
              {can('read', 'Subcategory') && (
                <Button variant="ghost" aria-pressed={selected?.id === row.id} aria-label={t('categories.subcategoriesOf', { name: row.name })} onClick={() => setSelected(selected?.id === row.id ? undefined : row)}>
                  {t('categories.subcategories')}
                </Button>
              )}
            </>
          ) : null
        }
      />
      {selected !== undefined && <SubcategoriesPanel key={selected.id} category={selected} />}
      {visibility !== undefined && <VisibilityDialog category={visibility} onClose={() => setVisibility(undefined)} />}
      {category !== null && <CategoryDialog record={category.mode === 'edit' ? category.record : undefined} onClose={() => setCategory(null)} />}
    </div>
  );
}

function SubcategoriesPanel({ category }: { readonly category: CategoryResponse }) {
  const { t } = useTranslation(['catalog', 'admin']);
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing<SubcategoryResponse>>(null);
  const priorities = useQuery(activePrioritiesQueryOptions(useApiClient()));
  const priorityName = (id: string | null) => (id === null ? '—' : (priorities.data?.find((priority) => priority.id === id)?.name ?? '—'));
  return (
    <Card title={t('subcategories.title', { category: category.name })}>
      <AdminList
        alsoInvalidates={CATALOG_DEPENDENTS}
        label={t('subcategories.tableLabel', { category: category.name })}
        path="/subcategories"
        item={subcategoryResponseSchema}
        filter={{ categoryId: category.id }}
        columns={[
          { key: 'name', header: t('admin:fields.name'), cell: (row) => row.name },
          { key: 'description', header: t('admin:fields.description'), cell: (row) => row.description ?? '—' },
          { key: 'priority', header: t('subcategories.defaultPriority'), width: '160px', cell: (row) => priorityName(row.defaultPriorityId) },
        ]}
        empty={t('subcategories.empty')}
        {...(can('create', 'Subcategory') ? { create: { label: t('subcategories.new'), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', 'Subcategory') ? { onEdit: (record: SubcategoryResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', 'Subcategory') && can('delete', 'Subcategory')}
      />
      {editing !== null && <SubcategoryDialog categoryId={category.id} record={editing.mode === 'edit' ? editing.record : undefined} priorities={priorities.data ?? []} onClose={() => setEditing(null)} />}
    </Card>
  );
}
