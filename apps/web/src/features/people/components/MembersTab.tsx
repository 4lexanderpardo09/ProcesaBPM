import type { MemberResponse, MemberStatus } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ADMIN_PAGE_SIZE, setAdminItemActive } from '@/shared/admin/admin-api';
import { AdminError } from '@/shared/admin/AdminError';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { useApiClient, useCurrentUser, usePermissions } from '@/shared/session';
import { Alert, Badge, type BadgeTone, Button, Pagination, PlusIcon, Select, Table, TextField } from '@/shared/ui';
import { departmentsQueryOptions, membersQueryOptions, positionsQueryOptions, resendInvitation, rolesQueryOptions } from '../api/people-api';
import { memberName } from '../lib/member-name';
import { MemberDialog } from './MemberDialog';
import { PeopleError } from './PeopleError';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './People.module.css';

const SEARCH_DELAY_MS = 300;
const STATUSES: readonly MemberStatus[] = ['INVITED', 'ACTIVE', 'INACTIVE'];
const STATUS_TONE: Record<MemberStatus, BadgeTone> = { INVITED: 'warn', ACTIVE: 'ok', INACTIVE: 'neutral' };

type Editing = { readonly mode: 'invite' } | { readonly mode: 'edit'; readonly member: MemberResponse } | null;

/**
 * The people of the organization: invite them by e-mail, change their role, position, department, site and
 * companies, send the invitation again, and deactivate who leaves (activate brings them back).
 */
export function MembersTab() {
  const { t } = useTranslation(['people', 'admin']);
  const { can } = usePermissions();
  const client = useApiClient();
  const me = useCurrentUser().data?.user.id;
  const [search, setSearch] = useState('');
  const [roleId, setRoleId] = useState('');
  const [status, setStatus] = useState<MemberStatus | ''>('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string>();
  const settled = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const members = useQuery(membersQueryOptions(client, { page, search: settled, roleId, status }));
  const roles = useQuery(rolesQueryOptions(client));
  const departments = useQuery(departmentsQueryOptions(client));
  const positions = useQuery(positionsQueryOptions(client));
  const toggle = useAdminMutation((c, member: MemberResponse) => setAdminItemActive(c, '/members', member.userId, member.status === 'INACTIVE'));
  const resend = useAdminMutation((c, member: MemberResponse) => resendInvitation(c, member.userId));
  const nameOf = (list: readonly { id: string; name: string }[] | undefined, id: string | null) => (id === null ? undefined : list?.find((item) => item.id === id)?.name);
  const canUpdate = can('update', 'Membership');
  const filtersChanged = () => setPage(1);

  return (
    <div className={styles.stack}>
      <div className={adminStyles.toolbar}>
        <div className={adminStyles.search}>
          <TextField
            label={t('admin:list.search')}
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              filtersChanged();
            }}
          />
        </div>
        <div className={styles.filter}>
          <Select
            label={t('members.role')}
            value={roleId}
            placeholder={t('members.allRoles')}
            options={(roles.data ?? []).map((role) => ({ value: role.id, label: role.name }))}
            onChange={(event) => {
              setRoleId(event.target.value);
              filtersChanged();
            }}
          />
        </div>
        <div className={styles.filter}>
          <Select
            label={t('members.statusFilter')}
            value={status}
            placeholder={t('members.current')}
            options={STATUSES.map((value) => ({ value, label: t(`members.statuses.${value}`) }))}
            onChange={(event) => {
              setStatus(STATUSES.find((value) => value === event.target.value) ?? '');
              filtersChanged();
            }}
          />
        </div>
        {can('create', 'Membership') && (
          <div className={adminStyles.toolbarEnd}>
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setEditing({ mode: 'invite' })}>
              {t('members.invite')}
            </Button>
          </div>
        )}
      </div>
      {notice !== undefined && <Alert tone="ok">{notice}</Alert>}
      <PeopleError error={toggle.error} context="member" />
      <AdminError error={resend.error} />
      <Table<MemberResponse>
        label={t('members.title')}
        rows={members.data?.items ?? []}
        rowKey={(row) => row.userId}
        loading={members.data === undefined && !members.isError}
        loadingLabel={t('admin:list.loading')}
        empty={members.isError ? t('admin:list.failed') : settled !== '' || roleId !== '' || status !== '' ? t('admin:list.noMatches') : t('members.empty')}
        footer={members.data !== undefined && members.data.total > ADMIN_PAGE_SIZE ? <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={members.data.total} onChange={setPage} /> : undefined}
        columns={[
          {
            key: 'name',
            header: t('members.name'),
            cell: (row) => (
              <span className={styles.name}>
                {memberName(row)}
                {row.isOwner && <Badge tone="accent">{t('members.owner')}</Badge>}
                {row.userId === me && <Badge>{t('members.you')}</Badge>}
              </span>
            ),
          },
          { key: 'email', header: t('members.email'), cell: (row) => row.email },
          { key: 'role', header: t('members.role'), width: '160px', cell: (row) => nameOf(roles.data, row.roleId) ?? '—' },
          {
            key: 'workplace',
            header: t('members.workplace'),
            cell: (row) => [nameOf(positions.data, row.positionId), nameOf(departments.data, row.departmentId)].filter((part) => part !== undefined).join(' · ') || '—',
          },
          { key: 'status', header: t('members.status'), width: '110px', cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{t(`members.statuses.${row.status}`)}</Badge> },
          {
            key: 'actions',
            header: t('admin:list.actions'),
            cell: (row) => (
              <div className={adminStyles.rowActions}>
                {canUpdate && (
                  <Button variant="ghost" aria-label={t('members.editNamed', { name: memberName(row) })} onClick={() => setEditing({ mode: 'edit', member: row })}>
                    {t('admin:list.edit')}
                  </Button>
                )}
                {canUpdate && row.status === 'INVITED' && (
                  <Button
                    variant="ghost"
                    aria-label={t('members.resendNamed', { name: memberName(row) })}
                    disabled={resend.isPending}
                    onClick={() => resend.mutate(row, { onSuccess: () => setNotice(t('members.resent', { email: row.email })) })}
                  >
                    {t('members.resend')}
                  </Button>
                )}
                {row.status === 'INACTIVE'
                  ? canUpdate && (
                      <Button variant="ghost" aria-label={t('members.activateNamed', { name: memberName(row) })} disabled={toggle.isPending} onClick={() => toggle.mutate(row)}>
                        {t('members.activate')}
                      </Button>
                    )
                  : can('delete', 'Membership') &&
                    !row.isOwner &&
                    row.userId !== me && (
                      <Button variant="ghost" aria-label={t('members.deactivateNamed', { name: memberName(row) })} disabled={toggle.isPending} onClick={() => toggle.mutate(row)}>
                        {t('members.deactivate')}
                      </Button>
                    )}
              </div>
            ),
          },
        ]}
      />
      {editing !== null && (
        <MemberDialog
          member={editing.mode === 'edit' ? editing.member : undefined}
          onClose={() => setEditing(null)}
          onInvited={(invited) => setNotice(t('members.invited', { email: invited.email }))}
        />
      )}
    </div>
  );
}
