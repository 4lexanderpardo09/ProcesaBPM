import type { TagResponse, TicketDetailResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { tagsQueryOptions } from '@/features/profile';
import { genericErrorMessage } from '@/shared/api';
import { paths } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Alert, Button, Card, Dialog, PlusIcon } from '@/shared/ui';
import { attachTicketTag, detachTicketTag } from '../api/ticket-tags-api';
import { ticketQueryKeys } from '../api/tickets-api';
import styles from './TicketTagsCard.module.css';

const byName = (a: TagResponse, b: TagResponse) => a.name.localeCompare(b.name, 'es');

/**
 * The caller's own tags on the ticket: remove one, or add one of theirs. Only the detail changes in place (the rest of the
 * ticket did not move); the inboxes read again because they show the tags.
 */
export function TicketTagsCard({ ticket }: { readonly ticket: TicketDetailResponse }) {
  const { t } = useTranslation('tickets');
  const { t: tCommon } = useTranslation();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const updateTags = (change: (tags: readonly TagResponse[]) => TagResponse[]) => {
    queryClient.setQueryData<TicketDetailResponse>(ticketQueryKeys.detail(ticket.id), (current) => (current === undefined ? current : { ...current, tags: change(current.tags).sort(byName) }));
    void queryClient.invalidateQueries({ queryKey: [...ticketQueryKeys.all, 'list'] });
  };
  const attach = useMutation({
    mutationFn: (tag: TagResponse) => attachTicketTag(client, ticket.id, tag.id),
    onSuccess: (_result, tag) => updateTags((tags) => [...tags.filter((current) => current.id !== tag.id), tag]),
  });
  const detach = useMutation({
    mutationFn: (tag: TagResponse) => detachTicketTag(client, ticket.id, tag.id),
    onSuccess: (_result, tag) => updateTags((tags) => tags.filter((current) => current.id !== tag.id)),
  });
  const error = attach.error ?? detach.error;
  const message = error === null ? undefined : genericErrorMessage(error);
  const busy = attach.isPending || detach.isPending;

  return (
    <Card title={t('detail.tags.title')}>
      <div className={styles.body}>
        {message !== undefined && <Alert tone="danger">{'values' in message ? tCommon(message.key, message.values) : tCommon(message.key)}</Alert>}
        <ul className={styles.chips} aria-label={t('detail.tags.title')}>
          {ticket.tags.map((tag) => (
            <li key={tag.id} className={styles.chip}>
              <span className={styles.dot} style={{ backgroundColor: tag.color }} aria-hidden="true" />
              {tag.name}
              <button
                type="button"
                className={styles.remove}
                aria-label={t('detail.tags.remove', { name: tag.name })}
                title={t('detail.tags.remove', { name: tag.name })}
                disabled={busy}
                onClick={() => {
                  attach.reset();
                  detach.mutate(tag);
                }}
              >
                <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className={styles.add} disabled={busy} onClick={() => setPicking(true)}>
              <PlusIcon size={12} />
              {t('detail.tags.add')}
            </button>
          </li>
        </ul>
      </div>
      {picking && (
        <TagPicker
          attached={ticket.tags}
          onPick={(tag) => {
            detach.reset();
            attach.mutate(tag);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </Card>
  );
}

interface TagPickerProps {
  readonly attached: readonly TagResponse[];
  readonly onPick: (tag: TagResponse) => void;
  readonly onClose: () => void;
}

/** The person's tags that are not on the ticket yet; with none, where to create them. */
function TagPicker({ attached, onPick, onClose }: TagPickerProps) {
  const { t } = useTranslation('tickets');
  const tags = useQuery(tagsQueryOptions(useApiClient()));
  const attachedIds = new Set(attached.map((tag) => tag.id));
  const available = tags.data?.filter((tag) => !attachedIds.has(tag.id)).sort(byName);
  return (
    <Dialog open title={t('detail.tags.pickTitle')} onClose={onClose} closeLabel={t('detail.tags.close')} footer={<Button onClick={onClose}>{t('detail.tags.close')}</Button>}>
      {available === undefined ? (
        <p className={styles.muted}>{tags.isError ? t('detail.tags.loadFailed') : t('detail.tags.loading')}</p>
      ) : available.length === 0 ? (
        <p className={styles.muted}>
          {tags.data?.length === 0 ? t('detail.tags.noneYet') : t('detail.tags.allUsed')}{' '}
          <Link to={`${paths.profile}?tab=tags`}>{t('detail.tags.manage')}</Link>
        </p>
      ) : (
        <ul className={styles.options}>
          {available.map((tag) => (
            <li key={tag.id}>
              <button type="button" className={styles.option} onClick={() => onPick(tag)}>
                <span className={styles.dot} style={{ backgroundColor: tag.color }} aria-hidden="true" />
                {tag.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
