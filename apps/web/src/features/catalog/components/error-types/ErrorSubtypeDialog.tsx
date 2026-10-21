import { type ErrorSubtypeResponse, errorSubtypeResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextArea, TextField } from '@/shared/ui';
import { saveCatalogItem } from '../../api/catalog-api';
import { useCatalogMutation } from '../../hooks/use-catalog-mutation';
import { CatalogDialog } from '../CatalogDialog';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

/** A subtype refines its error type (optional when reopening or reporting). */
export function ErrorSubtypeDialog({ path, record, onClose }: { readonly path: string; readonly record: ErrorSubtypeResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('catalog');
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useCatalogMutation((client, body: Record<string, unknown>) => saveCatalogItem(client, path, errorSubtypeResponseSchema, record?.id, body));

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const text = description.trim();
    save.mutate(record === undefined ? { name: name.trim(), ...(text === '' ? {} : { description: text }) } : { name: name.trim(), description: text === '' ? null : text }, { onSuccess: onClose });
  };

  return (
    <CatalogDialog title={record === undefined ? t('errorSubtypes.new') : t('errorSubtypes.edit')} submitLabel={t('dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextArea label={t('fields.description')} value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(event) => setDescription(event.target.value)} />
    </CatalogDialog>
  );
}
