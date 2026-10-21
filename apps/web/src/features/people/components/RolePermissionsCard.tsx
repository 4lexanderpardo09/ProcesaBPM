import type { RoleResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { currentUserQueryKey, myPermissionsQueryKey, useApiClient } from '@/shared/session';
import { Alert, Button, Card, Checkbox } from '@/shared/ui';
import { permissionCatalogQueryOptions, replaceRolePermissions, rolePermissionsQueryOptions } from '../api/people-api';
import { actionLabelKey, subjectLabelKey, subjectOrder } from '../lib/permission-labels';
import { draftChanged, draftOf, FULL_ACCESS, hasPermission, isConditional, type PermissionDraft, permissionsToSave, togglePermission } from '../lib/role-permissions';
import { PeopleError } from './PeopleError';
import styles from './People.module.css';

export interface RolePermissionsCardProps {
  readonly role: RoleResponse;
  readonly canEdit: boolean;
  readonly onClose: () => void;
}

/**
 * What a role can do, a box per kind of record with a checkbox per action. Nothing is saved until "Guardar
 * permisos", which replaces the whole list; a permission set with conditions through the API keeps them.
 */
export function RolePermissionsCard({ role, canEdit, onClose }: RolePermissionsCardProps) {
  const { t } = useTranslation(['people', 'admin']);
  const client = useApiClient();
  const catalog = useQuery(permissionCatalogQueryOptions(client));
  const saved = useQuery({ ...rolePermissionsQueryOptions(client, role.id), enabled: !role.isAdmin });
  const [draft, setDraft] = useState<PermissionDraft>();
  const [justSaved, setJustSaved] = useState(false);
  const save = useAdminMutation((c, value: PermissionDraft) => replaceRolePermissions(c, role.id, permissionsToSave(value)), [currentUserQueryKey, myPermissionsQueryKey]);
  const current = draft ?? (saved.data === undefined ? undefined : draftOf(saved.data));
  const changed = current !== undefined && saved.data !== undefined && draftChanged(current, saved.data);
  const subjects = (catalog.data ?? []).filter((group) => group.subject !== FULL_ACCESS.subject).sort((a, b) => subjectOrder(a.subject) - subjectOrder(b.subject));

  return (
    <Card
      title={t('permissions.title', { name: role.name })}
      actions={
        <Button variant="ghost" onClick={onClose}>
          {t('permissions.close')}
        </Button>
      }
    >
      {role.isAdmin ? (
        <p className={styles.note}>{t('permissions.adminHint')}</p>
      ) : catalog.isError || saved.isError ? (
        <Alert tone="danger">{t('admin:list.failed')}</Alert>
      ) : current === undefined || catalog.data === undefined ? (
        <p className={styles.note}>{t('permissions.loading')}</p>
      ) : (
        <div className={styles.stack}>
          {canEdit && <p className={styles.note}>{t('permissions.hint')}</p>}
          <div className={styles.subjects}>
            {subjects.map((group) => {
              const subjectKey = subjectLabelKey(group.subject);
              return (
                <fieldset key={group.subject} className={styles.subject}>
                  <legend>{subjectKey === undefined ? group.subject : t(subjectKey)}</legend>
                  {group.actions.map(({ action, description }) => {
                    const actionKey = actionLabelKey(group.subject, action);
                    const conditional = isConditional(current, action, group.subject);
                    return (
                      <div key={action}>
                        <Checkbox
                          label={actionKey === undefined ? (description ?? action) : t(actionKey)}
                          checked={hasPermission(current, action, group.subject)}
                          disabled={!canEdit || save.isPending}
                          onChange={(event) => {
                            setJustSaved(false);
                            setDraft(togglePermission(current, action, group.subject, event.target.checked));
                          }}
                        />
                        {conditional && (
                          <span className={styles.conditional} title={t('permissions.conditionalHint')}>
                            {t('permissions.conditional')}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </fieldset>
              );
            })}
          </div>
          {subjects.some((group) => group.actions.some(({ action }) => isConditional(current, action, group.subject))) && <p className={styles.note}>{t('permissions.conditionalHint')}</p>}
          <PeopleError error={save.error} context="rolePermissions" />
          {justSaved && !changed && <Alert tone="ok">{t('permissions.saved')}</Alert>}
          {canEdit && (
            <div className={styles.footer}>
              <Button disabled={!changed || save.isPending} onClick={() => setDraft(undefined)}>
                {t('permissions.discard')}
              </Button>
              <Button
                variant="brand"
                disabled={!changed || save.isPending}
                onClick={() =>
                  save.mutate(current, {
                    onSuccess: () => {
                      setDraft(undefined);
                      setJustSaved(true);
                    },
                  })
                }
              >
                {t('permissions.save')}
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
