import { type CategoryResponse, categoryResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/shared/ui';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';

const NAME_MAX = 200;

/** A new category, or a new name for one. */
export function CategoryDialog({ record, onClose }: { readonly record: CategoryResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['catalog', 'admin']);
  const [name, setName] = useState(record?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: string) => saveAdminItem(client, '/categories', categoryResponseSchema, record?.id, { name: value }), CATALOG_DEPENDENTS);
  return (
    <AdminDialog
      title={record === undefined ? t('categories.new') : t('categories.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate(name.trim(), { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </AdminDialog>
  );
}
