import { type NamedRecordResponse, namedRecordResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { AdminList } from '@/shared/admin/AdminList';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { usePermissions } from '@/shared/session';
import { TextField } from '@/shared/ui';

const NAME_MAX = 200;

export interface NamedRecordsTabProps {
  readonly path: '/departments' | '/positions';
  readonly subject: 'Department' | 'Position';
  readonly kind: 'departments' | 'positions';
}

type Editing = { readonly mode: 'create' } | { readonly mode: 'edit'; readonly record: NamedRecordResponse } | null;

/** Departments and positions: a name, unique in the organization, that people and steps refer to. */
export function NamedRecordsTab({ path, subject, kind }: NamedRecordsTabProps) {
  const { t } = useTranslation(['organization', 'admin']);
  const { can } = usePermissions();
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <>
      <AdminList
        label={t(`${kind}.title`)}
        path={path}
        item={namedRecordResponseSchema}
        columns={[{ key: 'name', header: t('admin:fields.name'), cell: (row) => row.name }]}
        empty={t(`${kind}.empty`)}
        {...(can('create', subject) ? { create: { label: t(`${kind}.new`), onClick: () => setEditing({ mode: 'create' }) } } : {})}
        {...(can('update', subject) ? { onEdit: (record: NamedRecordResponse) => setEditing({ mode: 'edit', record }) } : {})}
        canToggle={can('update', subject) && can('delete', subject)}
      />
      {editing !== null && <NamedRecordDialog path={path} title={t(editing.mode === 'create' ? `${kind}.new` : `${kind}.edit`)} record={editing.mode === 'edit' ? editing.record : undefined} onClose={() => setEditing(null)} />}
    </>
  );
}

function NamedRecordDialog({ path, title, record, onClose }: { readonly path: string; readonly title: string; readonly record: NamedRecordResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('admin');
  const [name, setName] = useState(record?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: string) => saveAdminItem(client, path, namedRecordResponseSchema, record?.id, { name: value }));
  return (
    <AdminDialog
      title={title}
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
    </AdminDialog>
  );
}
