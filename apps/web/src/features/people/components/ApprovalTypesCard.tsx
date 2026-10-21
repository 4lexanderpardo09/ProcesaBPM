import { type ApprovalGroupTypeResponse, approvalGroupTypeResponseSchema } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient } from '@/shared/session';
import { Badge, Button, Card, PlusIcon, TextField } from '@/shared/ui';
import { approvalTypesQueryOptions, deleteApprovalType } from '../api/people-api';
import { PeopleError } from './PeopleError';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './People.module.css';

const NAME_MAX = 200;

export interface ApprovalTypesCardProps {
  readonly canCreate: boolean;
  readonly canUpdate: boolean;
  readonly canDelete: boolean;
}

/** The kinds of approval a step can ask for ("Jefe inmediato", "Gerencia"…); each group belongs to one. */
export function ApprovalTypesCard({ canCreate, canUpdate, canDelete }: ApprovalTypesCardProps) {
  const { t } = useTranslation(['people', 'admin']);
  const types = useQuery(approvalTypesQueryOptions(useApiClient()));
  const [editing, setEditing] = useState<ApprovalGroupTypeResponse | 'new'>();
  const remove = useAdminMutation((client, typeId: string) => deleteApprovalType(client, typeId));
  return (
    <Card
      title={t('approvals.types.title')}
      actions={
        canCreate ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => setEditing('new')}>
            {t('approvals.types.new')}
          </Button>
        ) : undefined
      }
    >
      <p className={styles.note}>{t('approvals.types.hint')}</p>
      <PeopleError error={remove.error} context="approvalType" />
      {types.data?.length === 0 && <p className={styles.note}>{t('approvals.types.empty')}</p>}
      <ul className={styles.people} aria-label={t('approvals.types.title')}>
        {(types.data ?? []).map((type) => (
          <li key={type.id} className={styles.person}>
            <span className={styles.name}>
              {type.name}
              {type.isDefault && <Badge tone="accent">{t('approvals.types.default')}</Badge>}
            </span>
            <div className={adminStyles.rowActions}>
              {canUpdate && (
                <Button variant="ghost" aria-label={t('admin:list.editNamed', { name: type.name })} onClick={() => setEditing(type)}>
                  {t('admin:list.edit')}
                </Button>
              )}
              {canDelete && !type.isDefault && (
                <Button variant="ghost" aria-label={t('approvals.types.deleteNamed', { name: type.name })} disabled={remove.isPending} onClick={() => remove.mutate(type.id)}>
                  {t('approvals.types.delete')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {editing !== undefined && <TypeDialog record={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
    </Card>
  );
}

function TypeDialog({ record, onClose }: { readonly record: ApprovalGroupTypeResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const [name, setName] = useState(record?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: string) => saveAdminItem(client, '/approval-group-types', approvalGroupTypeResponseSchema, record?.id, { name: value }));
  return (
    <AdminDialog
      title={record === undefined ? t('approvals.types.new') : t('approvals.types.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate(name.trim(), { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} placeholder={t('approvals.types.placeholder')} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </AdminDialog>
  );
}
