import type { DelegationResponse, DirectoryPerson } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { ApiError } from '@/shared/api';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Alert, Badge, Button, Card, PlusIcon, TextArea, TextField } from '@/shared/ui';
import { cancelOwnDelegation, createOwnDelegation, directoryNamesQueryOptions, myDelegationsQueryOptions, toolsQueryKeys } from '../api/profile-api';
import { PersonPicker, personName } from './PersonPicker';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const REASON_MAX = 500;

/** `yyyy-MM-ddTHH:mm` in the browser's time zone, what a `datetime-local` field shows. */
function forInput(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/**
 * While the person is away, what would come to them to approve goes to someone else. Here, theirs in force or to
 * come: the ones they gave (which they can cancel) and the ones they received.
 */
export function MyDelegationsCard() {
  const { t } = useTranslation('profile');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const me = useCurrentUser().data?.user.id;
  const delegations = useQuery({ ...myDelegationsQueryOptions(client, me ?? ''), enabled: me !== undefined });
  const all = [...(delegations.data?.given ?? []), ...(delegations.data?.received ?? [])];
  const names = useQuery(directoryNamesQueryOptions(client, all.flatMap((delegation) => [delegation.fromUserId, delegation.toUserId])));
  const [creating, setCreating] = useState(false);
  const cancel = useMutation({ mutationFn: (delegationId: string) => cancelOwnDelegation(client, delegationId), onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.delegations }) });
  const nameOf = (userId: string) => {
    const person = names.data?.find((candidate) => candidate.userId === userId);
    return person === undefined ? '…' : personName(person);
  };
  const now = new Date();
  const period = (delegation: DelegationResponse) => t('delegations.range', { from: formatDateTime(delegation.startsAt), to: formatDateTime(delegation.endsAt) });
  const state = (delegation: DelegationResponse) => (new Date(delegation.startsAt) > now ? <Badge tone="warn">{t('delegations.scheduled')}</Badge> : <Badge tone="ok">{t('delegations.active')}</Badge>);

  return (
    <Card
      title={t('delegations.title')}
      actions={
        <Button icon={<PlusIcon size={15} />} onClick={() => setCreating(true)}>
          {t('delegations.new')}
        </Button>
      }
    >
      <div className={styles.form}>
        <p className={styles.note}>{t('delegations.hint')}</p>
        <ProfileError error={cancel.error} />
        {delegations.data === undefined ? (
          <p className={styles.note}>{delegations.isError ? t('loadFailed') : t('loading')}</p>
        ) : (
          <>
            <h3 className={styles.subtitle}>{t('delegations.given')}</h3>
            {delegations.data.given.length === 0 ? (
              <p className={styles.note}>{t('delegations.noneGiven')}</p>
            ) : (
              <ul className={styles.list} aria-label={t('delegations.given')}>
                {delegations.data.given.map((delegation) => (
                  <li key={delegation.id} className={styles.row}>
                    <span>
                      {t('delegations.to', { name: nameOf(delegation.toUserId) })} {state(delegation)}
                      <br />
                      <span className={styles.secondary}>
                        {period(delegation)}
                        {delegation.reason === null ? '' : ` · ${delegation.reason}`}
                      </span>
                    </span>
                    <Button variant="ghost" aria-label={t('delegations.cancelNamed', { name: nameOf(delegation.toUserId) })} disabled={cancel.isPending} onClick={() => cancel.mutate(delegation.id)}>
                      {new Date(delegation.startsAt) > now ? t('cancel') : t('delegations.end')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <h3 className={styles.subtitle}>{t('delegations.received')}</h3>
            {delegations.data.received.length === 0 ? (
              <p className={styles.note}>{t('delegations.noneReceived')}</p>
            ) : (
              <ul className={styles.list} aria-label={t('delegations.received')}>
                {delegations.data.received.map((delegation) => (
                  <li key={delegation.id} className={styles.row}>
                    <span>
                      {t('delegations.from', { name: nameOf(delegation.fromUserId) })} {state(delegation)}
                      <br />
                      <span className={styles.secondary}>{period(delegation)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {creating && me !== undefined && <DelegationDialog me={me} onClose={() => setCreating(false)} />}
    </Card>
  );
}

function DelegationDialog({ me, onClose }: { readonly me: string; readonly onClose: () => void }) {
  const { t } = useTranslation(['profile', 'admin']);
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [to, setTo] = useState<DirectoryPerson>();
  const [startsAt, setStartsAt] = useState(() => forInput(new Date()));
  const [endsAt, setEndsAt] = useState('');
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const create = useMutation({
    mutationFn: () => createOwnDelegation(client, { toUserId: to?.userId ?? '', startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), ...(reason.trim() === '' ? {} : { reason: reason.trim() }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.delegations }),
  });
  const periodInvalid = startsAt !== '' && endsAt !== '' && new Date(endsAt) <= new Date(startsAt);
  const overlap = create.error instanceof ApiError && create.error.code === 'OVERLAP';

  return (
    <AdminDialog
      title={t('delegations.new')}
      submitLabel={t('delegations.create')}
      pending={create.isPending}
      error={null}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (to !== undefined && startsAt !== '' && endsAt !== '' && !periodInvalid) create.mutate(undefined, { onSuccess: onClose });
      }}
    >
      {to === undefined ? (
        <>
          <PersonPicker label={t('delegations.searchTo')} actionLabel={t('delegations.choose')} actionLabelNamed={(name) => t('delegations.chooseNamed', { name })} taken={new Set([me])} onPick={setTo} />
          {submitted && <p className={styles.error}>{t('delegations.toRequired')}</p>}
        </>
      ) : (
        <p className={styles.row}>
          <span>{t('delegations.to', { name: personName(to) })}</span>
          <Button variant="ghost" onClick={() => setTo(undefined)}>
            {t('delegations.change')}
          </Button>
        </p>
      )}
      <div className={styles.pair}>
        <TextField label={t('delegations.startsAt')} type="datetime-local" required value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        <TextField
          label={t('delegations.endsAt')}
          type="datetime-local"
          required
          value={endsAt}
          error={periodInvalid ? t('delegations.endsBeforeStart') : submitted && endsAt === '' ? t('data.required') : undefined}
          onChange={(event) => setEndsAt(event.target.value)}
        />
      </div>
      <TextArea label={t('delegations.reason')} rows={2} value={reason} maxLength={REASON_MAX} placeholder={t('delegations.reasonPlaceholder')} onChange={(event) => setReason(event.target.value)} />
      {overlap ? <Alert tone="danger">{t('delegations.overlap')}</Alert> : <ProfileError error={create.error} />}
    </AdminDialog>
  );
}
