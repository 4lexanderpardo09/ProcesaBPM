import { type PriorityResponse, type SubcategoryResponse, subcategoryResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, TextArea, TextField } from '@/shared/ui';
import { saveCatalogItem } from '../../api/catalog-api';
import { useCatalogMutation } from '../../hooks/use-catalog-mutation';
import { CatalogDialog } from '../CatalogDialog';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 2000;

export interface SubcategoryDialogProps {
  readonly categoryId: string;
  readonly record: SubcategoryResponse | undefined;
  readonly priorities: readonly PriorityResponse[];
  readonly onClose: () => void;
}

/**
 * A subcategory of the category: its name, the description people see when they open a ticket of it, and the priority
 * a new ticket gets unless the person picks another. It never moves to another category (its workflow hangs from it).
 */
export function SubcategoryDialog({ categoryId, record, priorities, onClose }: SubcategoryDialogProps) {
  const { t } = useTranslation('catalog');
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [priorityId, setPriorityId] = useState(record?.defaultPriorityId ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useCatalogMutation((client, body: Record<string, unknown>) => saveCatalogItem(client, '/subcategories', subcategoryResponseSchema, record?.id, body));

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const text = description.trim();
    // Creating leaves out what is empty; editing sends `null` to clear it.
    const body =
      record === undefined
        ? { categoryId, name: name.trim(), ...(text === '' ? {} : { description: text }), ...(priorityId === '' ? {} : { defaultPriorityId: priorityId }) }
        : { name: name.trim(), description: text === '' ? null : text, defaultPriorityId: priorityId === '' ? null : priorityId };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <CatalogDialog title={record === undefined ? t('subcategories.new') : t('subcategories.edit')} submitLabel={t('dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextArea label={t('fields.description')} hint={t('subcategories.descriptionHint')} value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(event) => setDescription(event.target.value)} />
      <Select
        label={t('subcategories.defaultPriority')}
        hint={t('subcategories.defaultPriorityHint')}
        value={priorityId}
        placeholder={t('subcategories.noPriority')}
        options={priorities.map((priority) => ({ value: priority.id, label: priority.name }))}
        onChange={(event) => setPriorityId(event.target.value)}
      />
    </CatalogDialog>
  );
}
