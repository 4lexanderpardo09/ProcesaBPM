import { type CategoryResponse, categoryResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextField } from '@/shared/ui';
import { saveCatalogItem } from '../../api/catalog-api';
import { useCatalogMutation } from '../../hooks/use-catalog-mutation';
import { CatalogDialog } from '../CatalogDialog';

const NAME_MAX = 200;

/** A new category, or a new name for one. */
export function CategoryDialog({ record, onClose }: { readonly record: CategoryResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('catalog');
  const [name, setName] = useState(record?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useCatalogMutation((client, value: string) => saveCatalogItem(client, '/categories', categoryResponseSchema, record?.id, { name: value }));
  return (
    <CatalogDialog
      title={record === undefined ? t('categories.new') : t('categories.edit')}
      submitLabel={t('dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate(name.trim(), { onSuccess: onClose });
      }}
    >
      <TextField label={t('fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </CatalogDialog>
  );
}
