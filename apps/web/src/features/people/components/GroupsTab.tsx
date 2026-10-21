import { type GroupResponse, groupResponseSchema, type MemberResponse } from '@procesabpm/shared';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { AdminError } from '@/shared/admin/AdminError';
import { AdminList } from '@/shared/admin/AdminList';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient, usePermissions } from '@/shared/session';
import { Button, Dialog, TextField } from '@/shared/ui';
import { addGroupMember, groupMembersQueryOptions, memberQueryOptions, membersQueryOptions, removeGroupMember } from '../api/people-api';
import { memberName } from '../lib/member-name';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './People.module.css';

const NAME_MAX = 200;
const SEARCH_DELAY_MS = 300;
/** Enough results to find someone by name; more means the search should be more precise. */
const SEARCH_RESULTS = 8;

type Dialog = { readonly kind: 'create' } | { readonly kind: 'edit' | 'members'; readonly group: GroupResponse } | null;

/** Groups of people a step can be assigned to as a whole ("Tesorería", "Mesa de ayuda N1"…). */
export function GroupsTab() {
  const { t } = useTranslation(['people', 'admin']);
  const { can } = usePermissions();
  const [dialog, setDialog] = useState<Dialog>(null);
  return (
    <>
      <AdminList
        label={t('groups.title')}
        path="/groups"
        item={groupResponseSchema}
        columns={[{ key: 'name', header: t('admin:fields.name'), cell: (row) => row.name }]}
        empty={t('groups.empty')}
        {...(can('create', 'Group') ? { create: { label: t('groups.new'), onClick: () => setDialog({ kind: 'create' }) } } : {})}
        {...(can('update', 'Group') ? { onEdit: (group: GroupResponse) => setDialog({ kind: 'edit', group }) } : {})}
        canToggle={can('update', 'Group') && can('delete', 'Group')}
        rowAction={(row) => (
          <Button variant="ghost" aria-label={t('groups.membersNamed', { name: row.name })} onClick={() => setDialog({ kind: 'members', group: row })}>
            {t('groups.members')}
          </Button>
        )}
      />
      {dialog?.kind === 'create' && <GroupDialog record={undefined} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <GroupDialog record={dialog.group} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'members' && <GroupMembersDialog group={dialog.group} canEdit={can('update', 'Group')} onClose={() => setDialog(null)} />}
    </>
  );
}

function GroupDialog({ record, onClose }: { readonly record: GroupResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const [name, setName] = useState(record?.name ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: string) => saveAdminItem(client, '/groups', groupResponseSchema, record?.id, { name: value }));
  return (
    <AdminDialog
      title={record === undefined ? t('groups.new') : t('groups.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate(name.trim(), { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </AdminDialog>
  );
}

/** Who is in a group: each change is saved at once (adding or removing one person). */
function GroupMembersDialog({ group, canEdit, onClose }: { readonly group: GroupResponse; readonly canEdit: boolean; readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const client = useApiClient();
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const userIds = useQuery(groupMembersQueryOptions(client, group.id));
  const people = useQueries({ queries: (userIds.data ?? []).map((userId) => memberQueryOptions(client, userId)) });
  const candidates = useQuery({ ...membersQueryOptions(client, { page: 1, search: settled, roleId: '', status: 'ACTIVE' }), enabled: canEdit && settled !== '' });
  const add = useAdminMutation((c, userId: string) => addGroupMember(c, group.id, userId));
  const remove = useAdminMutation((c, userId: string) => removeGroupMember(c, group.id, userId));
  const inGroup = new Set(userIds.data ?? []);
  const members = people.flatMap((query) => (query.data === undefined ? [] : [query.data])).sort((a, b) => memberName(a).localeCompare(memberName(b), 'es'));

  return (
    <Dialog
      open
      title={t('groups.membersTitle', { name: group.name })}
      closeLabel={t('admin:dialog.close')}
      onClose={onClose}
      footer={<Button onClick={onClose}>{t('people:permissions.close')}</Button>}
    >
      <div className={adminStyles.dialogFields}>
        {userIds.data === undefined || people.some((query) => query.isPending) ? (
          <p className={styles.note}>{userIds.isError ? t('admin:list.failed') : t('admin:list.loading')}</p>
        ) : members.length === 0 ? (
          <p className={styles.note}>{t('groups.noMembers')}</p>
        ) : (
          <ul className={styles.people} aria-label={t('groups.members')}>
            {members.map((member) => (
              <li key={member.userId} className={styles.person}>
                <span>
                  {memberName(member)} <span className={styles.secondary}>{member.email}</span>
                </span>
                {canEdit && (
                  <Button variant="ghost" aria-label={t('groups.removeNamed', { name: memberName(member) })} disabled={remove.isPending} onClick={() => remove.mutate(member.userId)}>
                    {t('groups.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <AdminError error={add.error ?? remove.error} />
        {canEdit && (
          <>
            <TextField label={t('groups.search')} hint={t('groups.searchHint')} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
            {settled !== '' && candidates.data !== undefined && (
              <ul className={styles.people} aria-label={t('groups.search')}>
                {candidates.data.items.length === 0 && <li className={styles.note}>{t('groups.noResults')}</li>}
                {candidates.data.items.slice(0, SEARCH_RESULTS).map((candidate) => (
                  <li key={candidate.userId} className={styles.person}>
                    <span>
                      {memberName(candidate)} <span className={styles.secondary}>{candidate.email}</span>
                    </span>
                    {inGroup.has(candidate.userId) ? (
                      <span className={styles.secondary}>{t('groups.alreadyIn')}</span>
                    ) : (
                      <Button variant="ghost" aria-label={t('groups.addNamed', { name: memberName(candidate) })} disabled={add.isPending} onClick={() => add.mutate(candidate.userId)}>
                        {t('groups.add')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
