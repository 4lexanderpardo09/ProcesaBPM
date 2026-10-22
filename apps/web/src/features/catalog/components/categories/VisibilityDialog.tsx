import { type CategoryResponse, categoryVisibilityResponseSchema } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { companiesQueryOptions, departmentsQueryOptions } from '@/features/people';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Checkbox, Dialog } from '@/shared/ui';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';
import styles from '../Catalog.module.css';

const visibilityUrl = (categoryId: string) => `/categories/${encodeURIComponent(categoryId)}/visibility`;

type Axis = 'companyIds' | 'departmentIds';

/**
 * Who sees a category when opening a ticket: the people of some companies and of some departments. An empty list
 * means everyone on that axis; both apply together (a company listed and a department listed).
 */
export function VisibilityDialog({ category, onClose }: { readonly category: CategoryResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('catalog');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const current = useQuery({ queryKey: ['categories', category.id, 'visibility'], queryFn: ({ signal }) => client.request(visibilityUrl(category.id), { schema: categoryVisibilityResponseSchema, signal }) });
  const companies = useQuery(companiesQueryOptions(client));
  const departments = useQuery(departmentsQueryOptions(client));
  const [draft, setDraft] = useState<Record<Axis, readonly string[]>>();
  const value = draft ?? current.data;
  const save = useMutation({
    mutationFn: () => client.request(visibilityUrl(category.id), { method: 'PUT', body: value, schema: categoryVisibilityResponseSchema }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(['categories', category.id, 'visibility'], saved);
      await Promise.all(CATALOG_DEPENDENTS.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
      onClose();
    },
  });
  const toggle = (axis: Axis, id: string, on: boolean) => {
    if (value === undefined) return;
    setDraft({ ...value, [axis]: on ? [...value[axis], id] : value[axis].filter((candidate) => candidate !== id) });
  };
  const list = (axis: Axis, options: ReadonlyArray<{ id: string; name: string; isActive: boolean }> | undefined) => {
    const chosen = new Set(value?.[axis] ?? []);
    const shown = (options ?? []).filter((option) => option.isActive || chosen.has(option.id));
    return (
      <fieldset className={styles.checks}>
        <legend>{t(`visibility.${axis}`)}</legend>
        <p className={styles.note}>{chosen.size === 0 ? t(`visibility.everyone.${axis}`) : t(`visibility.only.${axis}`, { count: chosen.size })}</p>
        {shown.map((option) => (
          <Checkbox key={option.id} label={option.isActive ? option.name : t('visibility.inactive', { name: option.name })} checked={chosen.has(option.id)} onChange={(event) => toggle(axis, option.id, event.target.checked)} />
        ))}
        {options !== undefined && shown.length === 0 && <p className={styles.note}>{t(`visibility.none.${axis}`)}</p>}
      </fieldset>
    );
  };

  return (
    <Dialog
      open
      title={t('visibility.title', { name: category.name })}
      closeLabel={t('visibility.close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        if (value !== undefined && !save.isPending) save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('visibility.cancel')}</Button>
          <Button type="submit" variant="brand" disabled={value === undefined || save.isPending}>
            {save.isPending ? t('visibility.saving') : t('visibility.save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <p className={styles.note}>{t('visibility.hint')}</p>
        {current.isError ? (
          <Alert tone="danger">{t('visibility.loadFailed')}</Alert>
        ) : value === undefined ? (
          <p className={styles.note}>{t('visibility.loading')}</p>
        ) : (
          <>
            {list('companyIds', companies.data)}
            {list('departmentIds', departments.data)}
          </>
        )}
        {save.isError && <Alert tone="danger">{t('visibility.saveFailed')}</Alert>}
      </div>
    </Dialog>
  );
}
