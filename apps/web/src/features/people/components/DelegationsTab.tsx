import type { DelegationResponse, MemberResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { ADMIN_PAGE_SIZE } from '@/shared/admin/admin-api';
import { AdminError } from '@/shared/admin/AdminError';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { useApiClient } from '@/shared/session';
import { Badge, type BadgeTone, Button, Checkbox, Pagination, PlusIcon, Table, TextArea, TextField } from '@/shared/ui';
import { cancelDelegation, createDelegation, delegationsQueryOptions } from '../api/people-api';
import { useMembersById } from '../hooks/use-members-by-id';
import { delegationState, type DelegationState } from '../lib/delegation-state';
import { memberName } from '../lib/member-name';
import { peopleErrorKey } from '../lib/people-error';
import { MemberSearch } from './MemberSearch';
import { PeopleError } from './PeopleError';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './People.module.css';

const REASON_MAX = 500;
const STATE_TONE: Record<DelegationState, BadgeTone> = { scheduled: 'warn', active: 'ok', ended: 'neutral' };

/**
 * Who approves for whom while they are away: in that period, what would go to the person goes to their delegate.
 * Shown to whoever manages everyone's delegations; each person's own will live in their profile.
 */
export function DelegationsTab() {
  const { t } = useTranslation(['people', 'admin']);
  const [current, setCurrent] = useState(true);
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const delegations = useQuery(delegationsQueryOptions(useApiClient(), page, current));
  const items = delegations.data?.items ?? [];
  const people = useMembersById(items.flatMap((delegation) => [delegation.fromUserId, delegation.toUserId]));
  const cancel = useAdminMutation((client, delegationId: string) => cancelDelegation(client, delegationId));
  const nameOf = (userId: string) => {
    const member = people.byId.get(userId);
    return member === undefined ? '…' : memberName(member);
  };
  const now = new Date();

  return (
    <div className={styles.stack}>
      <div className={adminStyles.toolbar}>
        <Checkbox
          label={t('delegations.currentOnly')}
          checked={current}
          onChange={(event) => {
            setCurrent(event.target.checked);
            setPage(1);
          }}
        />
        <div className={adminStyles.toolbarEnd}>
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
            {t('delegations.new')}
          </Button>
        </div>
      </div>
      <AdminError error={cancel.error} />
      <Table<DelegationResponse>
        label={t('delegations.title')}
        rows={items}
        rowKey={(row) => row.id}
        loading={delegations.data === undefined && !delegations.isError}
        loadingLabel={t('admin:list.loading')}
        empty={delegations.isError ? t('admin:list.failed') : t('delegations.empty')}
        footer={delegations.data !== undefined && delegations.data.total > ADMIN_PAGE_SIZE ? <Pagination page={page} pageSize={ADMIN_PAGE_SIZE} total={delegations.data.total} onChange={setPage} /> : undefined}
        columns={[
          { key: 'from', header: t('delegations.from'), cell: (row) => nameOf(row.fromUserId) },
          { key: 'to', header: t('delegations.to'), cell: (row) => nameOf(row.toUserId) },
          { key: 'period', header: t('delegations.period'), cell: (row) => t('delegations.range', { from: formatDateTime(row.startsAt), to: formatDateTime(row.endsAt) }) },
          { key: 'reason', header: t('delegations.reason'), cell: (row) => row.reason ?? '—' },
          {
            key: 'state',
            header: t('admin:list.status'),
            width: '120px',
            cell: (row) => {
              const state = delegationState(row, now);
              return <Badge tone={STATE_TONE[state]}>{t(`delegations.states.${state}`)}</Badge>;
            },
          },
          {
            key: 'actions',
            header: t('admin:list.actions'),
            cell: (row) =>
              delegationState(row, now) === 'ended' ? null : (
                <div className={adminStyles.rowActions}>
                  <Button variant="ghost" aria-label={t('delegations.cancelNamed', { from: nameOf(row.fromUserId), to: nameOf(row.toUserId) })} disabled={cancel.isPending} onClick={() => cancel.mutate(row.id)}>
                    {delegationState(row, now) === 'active' ? t('delegations.end') : t('delegations.cancel')}
                  </Button>
                </div>
              ),
          },
        ]}
      />
      {creating && <DelegationDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

/** `yyyy-MM-ddTHH:mm` in the browser's time zone, what a `datetime-local` field shows. */
function forInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function DelegationDialog({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation(['people', 'admin']);
  const [from, setFrom] = useState<MemberResponse>();
  const [to, setTo] = useState<MemberResponse>();
  const [startsAt, setStartsAt] = useState(() => forInput(new Date()));
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const create = useAdminMutation((client, _: undefined) =>
    createDelegation(client, {
      fromUserId: from?.userId ?? '',
      toUserId: to?.userId ?? '',
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
    }),
  );
  const periodInvalid = startsAt !== '' && endsAt !== '' && new Date(endsAt) <= new Date(startsAt);
  const samePerson = from !== undefined && to !== undefined && from.userId === to.userId;
  const ready = from !== undefined && to !== undefined && !samePerson && startsAt !== '' && endsAt !== '' && !periodInvalid;

  const chosen = (member: MemberResponse | undefined, clear: () => void, label: string) =>
    member === undefined ? null : (
      <p className={styles.person}>
        <span>
          <span className={styles.secondary}>{label}: </span>
          {memberName(member)}
        </span>
        <Button variant="ghost" onClick={clear}>
          {t('delegations.change')}
        </Button>
      </p>
    );

  return (
    <AdminDialog
      title={t('delegations.new')}
      submitLabel={t('delegations.create')}
      pending={create.isPending}
      error={peopleErrorKey(create.error, 'delegation') === undefined ? create.error : null}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (ready) create.mutate(undefined, { onSuccess: onClose });
      }}
    >
      <p className={styles.note}>{t('delegations.hint')}</p>
      {chosen(from, () => setFrom(undefined), t('delegations.from')) ?? (
        <MemberSearch label={t('delegations.searchFrom')} actionLabel={t('delegations.choose')} actionLabelNamed={(name) => t('delegations.chooseFromNamed', { name })} onPick={setFrom} />
      )}
      {chosen(to, () => setTo(undefined), t('delegations.to')) ?? (
        <MemberSearch label={t('delegations.searchTo')} actionLabel={t('delegations.choose')} actionLabelNamed={(name) => t('delegations.chooseToNamed', { name })} onPick={setTo} />
      )}
      {submitted && (from === undefined || to === undefined) && <p className={styles.error}>{t('delegations.peopleRequired')}</p>}
      {samePerson && <p className={styles.error}>{t('delegations.samePerson')}</p>}
      <div className={styles.names}>
        <TextField label={t('delegations.startsAt')} type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        <TextField
          label={t('delegations.endsAt')}
          type="datetime-local"
          required
          value={endsAt}
          error={periodInvalid ? t('delegations.endsBeforeStart') : submitted && endsAt === '' ? t('delegations.endsRequired') : undefined}
          onChange={(event) => setEndsAt(event.target.value)}
        />
      </div>
      <TextArea label={t('delegations.reason')} value={reason} maxLength={REASON_MAX} rows={2} placeholder={t('delegations.reasonPlaceholder')} onChange={(event) => setReason(event.target.value)} />
      <PeopleError error={peopleErrorKey(create.error, 'delegation') === undefined ? null : create.error} context="delegation" />
    </AdminDialog>
  );
}
