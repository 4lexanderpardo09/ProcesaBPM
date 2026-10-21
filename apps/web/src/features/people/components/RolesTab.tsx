import { type RoleResponse, roleResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { AdminList } from '@/shared/admin/AdminList';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { currentUserQueryKey, myPermissionsQueryKey, usePermissions } from '@/shared/session';
import { Badge, Button } from '@/shared/ui';
import { deleteRole } from '../api/people-api';
import { peopleErrorKey } from '../lib/people-error';
import { PeopleError } from './PeopleError';
import { RoleDialog } from './RoleDialog';
import { RolePermissionsCard } from './RolePermissionsCard';
import styles from './People.module.css';

type Dialog = { readonly kind: 'create' } | { readonly kind: 'edit' | 'delete'; readonly role: RoleResponse } | null;

/** A change to a role can change what the person themselves may do: their permissions are read again. */
const ROLE_DEPENDENTS = [currentUserQueryKey, myPermissionsQueryKey];

/**
 * The roles: what each one can do. The base roles come with the organization and cannot be deleted; an
 * administrator role can do everything. Below the list, the permissions of the role chosen.
 */
export function RolesTab() {
  const { t } = useTranslation(['people', 'admin']);
  const { can } = usePermissions();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [shown, setShown] = useState<RoleResponse>();
  const canUpdate = can('update', 'Role');

  return (
    <div className={styles.stack}>
      <AdminList
        label={t('roles.title')}
        path="/roles"
        item={roleResponseSchema}
        alsoInvalidates={ROLE_DEPENDENTS}
        columns={[
          {
            key: 'name',
            header: t('admin:fields.name'),
            cell: (row) => (
              <span className={styles.name}>
                {row.name}
                {row.systemRole !== null && <Badge>{t('roles.base')}</Badge>}
                {row.isAdmin && <Badge tone="accent">{t('roles.admin')}</Badge>}
              </span>
            ),
          },
          { key: 'description', header: t('roles.description'), cell: (row) => row.description ?? '—' },
        ]}
        empty={t('roles.empty')}
        {...(can('create', 'Role') ? { create: { label: t('roles.new'), onClick: () => setDialog({ kind: 'create' }) } } : {})}
        {...(canUpdate ? { onEdit: (role: RoleResponse) => setDialog({ kind: 'edit', role }) } : {})}
        canToggle={canUpdate && can('delete', 'Role')}
        rowAction={(row) => (
          <>
            <Button variant="ghost" aria-label={t('roles.permissionsNamed', { name: row.name })} onClick={() => setShown(row)}>
              {t('roles.permissions')}
            </Button>
            {can('delete', 'Role') && row.systemRole === null && (
              <Button variant="ghost" aria-label={t('roles.deleteNamed', { name: row.name })} onClick={() => setDialog({ kind: 'delete', role: row })}>
                {t('roles.delete')}
              </Button>
            )}
          </>
        )}
      />
      {shown !== undefined && <RolePermissionsCard key={shown.id} role={shown} canEdit={canUpdate} onClose={() => setShown(undefined)} />}
      {dialog?.kind === 'create' && <RoleDialog record={undefined} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <RoleDialog record={dialog.role} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <DeleteRoleDialog
          role={dialog.role}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            if (shown?.id === dialog.role.id) setShown(undefined);
          }}
        />
      )}
    </div>
  );
}

function DeleteRoleDialog({ role, onClose, onDeleted }: { readonly role: RoleResponse; readonly onClose: () => void; readonly onDeleted: () => void }) {
  const { t } = useTranslation('people');
  const remove = useAdminMutation((client, roleId: string) => deleteRole(client, roleId));
  return (
    <AdminDialog
      title={t('roles.deleteTitle', { name: role.name })}
      submitLabel={t('roles.delete')}
      pending={remove.isPending}
      error={peopleErrorKey(remove.error, 'role') === undefined ? remove.error : null}
      onClose={onClose}
      onSubmit={() =>
        remove.mutate(role.id, {
          onSuccess: () => {
            onDeleted();
            onClose();
          },
        })
      }
    >
      <p className={styles.note}>{t('roles.deleteHint')}</p>
      <PeopleError error={peopleErrorKey(remove.error, 'role') === undefined ? null : remove.error} context="role" />
    </AdminDialog>
  );
}
