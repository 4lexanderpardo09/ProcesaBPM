import { type PriorityResponse, priorityResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Checkbox, TextField } from '@/shared/ui';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { CATALOG_DEPENDENTS } from '../../lib/catalog-dependents';

const NAME_MAX = 200;
const ORDER_MAX = 10_000;
const DEFAULT_COLOR = '#0369a1';
const INTEGER = /^\d+$/;

/**
 * A priority: its name, its place in the list (lower first), optionally a color, and whether it is the default (the one
 * a ticket takes when its requester chooses none, like «Media» in the help desk).
 */
export function PriorityDialog({ record, onClose }: { readonly record: PriorityResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['catalog', 'admin']);
  const [name, setName] = useState(record?.name ?? '');
  const [order, setOrder] = useState(record === undefined ? '' : String(record.sortOrder));
  const [withColor, setWithColor] = useState(record?.color !== null && record?.color !== undefined);
  const [color, setColor] = useState(record?.color ?? DEFAULT_COLOR);
  const [isDefault, setIsDefault] = useState(record?.isDefault ?? false);
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/priorities', priorityResponseSchema, record?.id, body), CATALOG_DEPENDENTS);
  const orderInvalid = order.trim() !== '' && (!INTEGER.test(order.trim()) || Number(order) > ORDER_MAX);

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '' || orderInvalid) return;
    const sortOrder = order.trim() === '' ? undefined : Number(order);
    const body =
      record === undefined
        ? { name: name.trim(), ...(sortOrder === undefined ? {} : { sortOrder }), ...(withColor ? { color } : {}), ...(isDefault ? { isDefault } : {}) }
        : { name: name.trim(), ...(sortOrder === undefined ? {} : { sortOrder }), color: withColor ? color : null, ...(isDefault !== record.isDefault ? { isDefault } : {}) };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <AdminDialog title={record === undefined ? t('priorities.new') : t('priorities.edit')} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextField label={t('priorities.order')} hint={t('priorities.orderHint')} inputMode="numeric" value={order} error={orderInvalid ? t('priorities.orderInvalid', { max: ORDER_MAX }) : undefined} onChange={(event) => setOrder(event.target.value)} />
      <Checkbox label={t('priorities.withColor')} checked={withColor} onChange={(event) => setWithColor(event.target.checked)} />
      {withColor && <TextField label={t('priorities.color')} type="color" value={color} onChange={(event) => setColor(event.target.value)} />}
      {(record === undefined || record.isActive) && <Checkbox label={t('priorities.default')} checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />}
    </AdminDialog>
  );
}
