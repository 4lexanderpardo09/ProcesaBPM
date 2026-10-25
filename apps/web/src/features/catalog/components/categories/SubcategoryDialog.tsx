import { type PriorityResponse, SUBCATEGORY_DESCRIPTION_MAX, type SubcategoryResponse, subcategoryResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { textAsHtml } from '@/shared/lib/text-as-html';
import { isBlankRichText, RichTextEditor, Select, TextField } from '@/shared/ui';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';

const NAME_MAX = 200;

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
  const { t } = useTranslation(['catalog', 'admin']);
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(textAsHtml(record?.description ?? ''));
  const [priorityId, setPriorityId] = useState(record?.defaultPriorityId ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/subcategories', subcategoryResponseSchema, record?.id, body), CATALOG_DEPENDENTS);

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const text = isBlankRichText(description) ? '' : description;
    // Creating leaves out what is empty; editing sends `null` to clear it.
    const body =
      record === undefined
        ? { categoryId, name: name.trim(), ...(text === '' ? {} : { description: text }), ...(priorityId === '' ? {} : { defaultPriorityId: priorityId }) }
        : { name: name.trim(), description: text === '' ? null : text, defaultPriorityId: priorityId === '' ? null : priorityId };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <AdminDialog title={record === undefined ? t('subcategories.new') : t('subcategories.edit')} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <RichTextEditor label={t('admin:fields.description')} hint={t('subcategories.descriptionHint')} value={description} maxLength={SUBCATEGORY_DESCRIPTION_MAX} minHeight={80} onValueChange={setDescription} />
      <Select
        label={t('subcategories.defaultPriority')}
        hint={t('subcategories.defaultPriorityHint')}
        value={priorityId}
        placeholder={t('subcategories.noPriority')}
        options={priorities.map((priority) => ({ value: priority.id, label: priority.name }))}
        onChange={(event) => setPriorityId(event.target.value)}
      />
    </AdminDialog>
  );
}
