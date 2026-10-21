import type { TagResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useApiClient } from '@/shared/session';
import { Button, Card, PlusIcon, TextField } from '@/shared/ui';
import { deleteTag, saveTag, tagsQueryOptions } from '../api/profile-api';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const NAME_MAX = 200;
const DEFAULT_COLOR = '#0369a1';

type Editing = { readonly kind: 'edit'; readonly tag: TagResponse | undefined } | { readonly kind: 'delete'; readonly tag: TagResponse } | null;

/** The person's own tags, to mark tickets in their inboxes; nobody else sees them. */
export function TagsCard() {
  const { t } = useTranslation('profile');
  const tags = useQuery(tagsQueryOptions(useApiClient()));
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <Card
      title={t('tags.title')}
      actions={
        <Button icon={<PlusIcon size={15} />} onClick={() => setEditing({ kind: 'edit', tag: undefined })}>
          {t('tags.new')}
        </Button>
      }
    >
      <div className={styles.form}>
        <p className={styles.note}>{t('tags.hint')}</p>
        {tags.data === undefined ? (
          <p className={styles.note}>{tags.isError ? t('loadFailed') : t('loading')}</p>
        ) : tags.data.length === 0 ? (
          <p className={styles.note}>{t('tags.empty')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('tags.title')}>
            {tags.data.map((tag) => (
              <li key={tag.id} className={styles.row}>
                <span>
                  <span className={styles.swatch} style={{ background: tag.color }} aria-hidden="true" />
                  {tag.name}
                </span>
                <div className={styles.rowActions}>
                  <Button variant="ghost" aria-label={t('tags.editNamed', { name: tag.name })} onClick={() => setEditing({ kind: 'edit', tag })}>
                    {t('edit')}
                  </Button>
                  <Button variant="ghost" aria-label={t('tags.deleteNamed', { name: tag.name })} onClick={() => setEditing({ kind: 'delete', tag })}>
                    {t('delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing?.kind === 'edit' && <TagDialog tag={editing.tag} onClose={() => setEditing(null)} />}
      {editing?.kind === 'delete' && <DeleteTagDialog tag={editing.tag} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function useTagChange<TArgs>(action: (client: ReturnType<typeof useApiClient>, args: TArgs) => Promise<unknown>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => action(client, args),
    // The inboxes show the tags of each ticket: they are read again too.
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: tagsQueryOptions(client).queryKey }), queryClient.invalidateQueries({ queryKey: ['tickets'] })]),
  });
}

function TagDialog({ tag, onClose }: { readonly tag: TagResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['profile', 'admin']);
  const [name, setName] = useState(tag?.name ?? '');
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);
  const [submitted, setSubmitted] = useState(false);
  const save = useTagChange((client, body: { name: string; color: string }) => saveTag(client, tag?.id, body));
  return (
    <AdminDialog
      title={tag === undefined ? t('tags.new') : t('tags.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate({ name: name.trim(), color }, { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} placeholder={t('tags.placeholder')} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <TextField label={t('tags.color')} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
    </AdminDialog>
  );
}

function DeleteTagDialog({ tag, onClose }: { readonly tag: TagResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('profile');
  const remove = useTagChange((client, tagId: string) => deleteTag(client, tagId));
  return (
    <AdminDialog title={t('tags.deleteTitle', { name: tag.name })} submitLabel={t('delete')} pending={remove.isPending} error={null} onClose={onClose} onSubmit={() => remove.mutate(tag.id, { onSuccess: onClose })}>
      <p className={styles.note}>{t('tags.deleteHint')}</p>
      <ProfileError error={remove.error} />
    </AdminDialog>
  );
}
