import { type RoleResponse, roleResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { currentUserQueryKey, myPermissionsQueryKey, useCurrentUser } from '@/shared/session';
import { Checkbox, TextArea, TextField } from '@/shared/ui';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 500;

/** A role's name, what it is for and, for an administrator only, whether it can do everything. */
export function RoleDialog({ record, onClose }: { readonly record: RoleResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const iAmAdmin = useCurrentUser().data?.membership.role.isAdmin === true;
  const [name, setName] = useState(record?.name ?? '');
  const [description, setDescription] = useState(record?.description ?? '');
  const [isAdmin, setIsAdmin] = useState(record?.isAdmin ?? false);
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/roles', roleResponseSchema, record?.id, body), [currentUserQueryKey, myPermissionsQueryKey]);

  const submit = () => {
    setSubmitted(true);
    if (name.trim() === '') return;
    const text = description.trim();
    const adminFlag = iAmAdmin && isAdmin !== (record?.isAdmin ?? false) ? { isAdmin } : {};
    const body = record === undefined ? { name: name.trim(), ...(text === '' ? {} : { description: text }), ...adminFlag } : { name: name.trim(), description: text === '' ? null : text, ...adminFlag };
    save.mutate(body, { onSuccess: onClose });
  };

  return (
    <AdminDialog title={record === undefined ? t('roles.new') : t('roles.edit')} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={save.error} onClose={onClose} onSubmit={submit}>
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextArea label={t('roles.description')} value={description} maxLength={DESCRIPTION_MAX} rows={3} onChange={(event) => setDescription(event.target.value)} />
      {iAmAdmin && <Checkbox label={t('roles.isAdmin')} checked={isAdmin} onChange={(event) => setIsAdmin(event.target.checked)} />}
    </AdminDialog>
  );
}
