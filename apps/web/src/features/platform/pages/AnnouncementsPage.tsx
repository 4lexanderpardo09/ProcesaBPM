import type { PlatformAnnouncementResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/shared/lib/format-date-time';
import { Badge, Button, Dialog, PageHeader, PlusIcon, Table } from '@/shared/ui';
import { announcementsQueryOptions, deleteAnnouncement, platformQueryKeys } from '../api/platform-api';
import { AnnouncementDialog } from '../components/AnnouncementDialog';
import { PlatformError } from '../components/PlatformError';
import { usePlatformClient } from '../session/PlatformSessionContext';
import styles from './Platform.module.css';

type Announcement = PlatformAnnouncementResponse;

/** The platform's announcements (the help desk's maintenance and release notes), newest first, made and changed here. */
export function AnnouncementsPage() {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const announcements = useQuery(announcementsQueryOptions(client));
  const [editing, setEditing] = useState<Announcement | 'new'>();
  const [removing, setRemoving] = useState<Announcement>();
  const remove = useMutation({
    mutationFn: (id: string) => deleteAnnouncement(client, id),
    onSuccess: async () => {
      setRemoving(undefined);
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.announcements() });
    },
  });
  const when = (row: Announcement) => (row.endsAt === null ? t('announcements.from', { start: formatDateTime(row.startsAt) }) : t('announcements.range', { start: formatDateTime(row.startsAt), end: formatDateTime(row.endsAt) }));

  return (
    <>
      <PageHeader
        title={t('announcements.title')}
        subtitle={t('announcements.subtitle')}
        actions={
          <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setEditing('new')}>
            {t('announcements.new')}
          </Button>
        }
      />
      {announcements.isError && <PlatformError error={announcements.error} onRetry={() => void announcements.refetch()} />}
      <Table<Announcement>
        label={t('announcements.tableLabel')}
        rows={announcements.data ?? []}
        rowKey={(row) => row.id}
        loading={announcements.data === undefined && !announcements.isError}
        loadingLabel={t('loading')}
        empty={t('announcements.empty')}
        columns={[
          { key: 'title', header: t('announcements.columns.title'), cell: (row) => row.title },
          { key: 'type', header: t('announcements.columns.type'), width: '150px', cell: (row) => <Badge tone={row.type === 'MAINTENANCE' ? 'warn' : row.type === 'RELEASE_NOTES' ? 'accent' : 'neutral'}>{t(`announcements.types.${row.type}`)}</Badge> },
          { key: 'when', header: t('announcements.columns.when'), cell: when },
          { key: 'audience', header: t('announcements.columns.audience'), width: '140px', cell: (row) => (row.audience === 'ALL' ? t('announcements.everyone') : t('announcements.some', { count: row.tenantIds.length })) },
          { key: 'blocks', header: t('announcements.columns.blocks'), width: '100px', cell: (row) => (row.blocksLogin ? <Badge tone="danger">{t('announcements.blocks')}</Badge> : t('announcements.open')) },
          {
            key: 'actions',
            header: '',
            width: '170px',
            cell: (row) => (
              <div className={styles.actions}>
                <Button variant="ghost" aria-label={t('announcements.edit', { title: row.title })} onClick={() => setEditing(row)}>
                  {t('announcements.editShort')}
                </Button>
                <Button variant="ghost" aria-label={t('announcements.remove', { title: row.title })} onClick={() => setRemoving(row)}>
                  {t('announcements.removeAction')}
                </Button>
              </div>
            ),
          },
        ]}
      />
      {editing !== undefined && <AnnouncementDialog announcement={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
      {removing !== undefined && (
        <Dialog
          open
          title={t('announcements.removeAction')}
          closeLabel={t('close')}
          onClose={() => setRemoving(undefined)}
          footer={
            <>
              <Button onClick={() => setRemoving(undefined)}>{t('cancel')}</Button>
              <Button variant="primary" disabled={remove.isPending} onClick={() => remove.mutate(removing.id)}>
                {t('announcements.removeAction')}
              </Button>
            </>
          }
        >
          <p className={styles.note}>{t('announcements.removeConfirm', { title: removing.title })}</p>
          {remove.isError && <PlatformError error={remove.error} />}
        </Dialog>
      )}
    </>
  );
}
