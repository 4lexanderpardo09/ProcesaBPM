import { RICH_TEXT_MAX, type TextTemplateResponse } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useApiClient, useCurrentUser } from '@/shared/session';
import { Alert, Button, Card, Dialog, isBlankRichText, PlusIcon, RichText, RichTextEditor, TextField } from '@/shared/ui';
import { deleteTemplate, directoryNamesQueryOptions, saveTemplate, setTemplateShares, templateSharesQueryOptions, templatesQueryOptions, toolsQueryKeys } from '../api/profile-api';
import { PersonPicker, personName } from './PersonPicker';
import { ProfileError } from './ProfileError';
import styles from './Profile.module.css';

const TITLE_MAX = 200;

type Editing = { readonly kind: 'edit'; readonly template: TextTemplateResponse | undefined } | { readonly kind: 'delete' | 'share' | 'view'; readonly template: TextTemplateResponse } | null;

/**
 * Text the person reuses in comments ("Recibimos tu solicitud…"). Their own ones are edited and shared read-only with
 * colleagues; the ones shared with them can only be read.
 */
export function TemplatesCard() {
  const { t } = useTranslation('profile');
  const templates = useQuery(templatesQueryOptions(useApiClient()));
  const [editing, setEditing] = useState<Editing>(null);
  return (
    <Card
      title={t('templates.title')}
      actions={
        <Button icon={<PlusIcon size={15} />} onClick={() => setEditing({ kind: 'edit', template: undefined })}>
          {t('templates.new')}
        </Button>
      }
    >
      <div className={styles.form}>
        <p className={styles.note}>{t('templates.hint')}</p>
        {templates.data === undefined ? (
          <p className={styles.note}>{templates.isError ? t('loadFailed') : t('loading')}</p>
        ) : templates.data.length === 0 ? (
          <p className={styles.note}>{t('templates.empty')}</p>
        ) : (
          <ul className={styles.list} aria-label={t('templates.title')}>
            {templates.data.map((template) => (
              <li key={template.id} className={styles.row}>
                <span>
                  {template.title} <span className={styles.secondary}>{template.isOwner ? t('templates.yours') : t('templates.sharedBy', { name: template.ownerName })}</span>
                </span>
                <div className={styles.rowActions}>
                  <Button variant="ghost" aria-label={t('templates.viewNamed', { name: template.title })} onClick={() => setEditing({ kind: 'view', template })}>
                    {t('templates.view')}
                  </Button>
                  {template.isOwner && (
                    <>
                      <Button variant="ghost" aria-label={t('templates.editNamed', { name: template.title })} onClick={() => setEditing({ kind: 'edit', template })}>
                        {t('edit')}
                      </Button>
                      <Button variant="ghost" aria-label={t('templates.shareNamed', { name: template.title })} onClick={() => setEditing({ kind: 'share', template })}>
                        {t('templates.share')}
                      </Button>
                      <Button variant="ghost" aria-label={t('templates.deleteNamed', { name: template.title })} onClick={() => setEditing({ kind: 'delete', template })}>
                        {t('delete')}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing?.kind === 'edit' && <TemplateDialog template={editing.template} onClose={() => setEditing(null)} />}
      {editing?.kind === 'view' && <ViewDialog template={editing.template} onClose={() => setEditing(null)} />}
      {editing?.kind === 'share' && <ShareDialog template={editing.template} onClose={() => setEditing(null)} />}
      {editing?.kind === 'delete' && <DeleteDialog template={editing.template} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function useTemplateChange<TArgs>(action: (client: ReturnType<typeof useApiClient>, args: TArgs) => Promise<unknown>) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (args: TArgs) => action(client, args), onSuccess: () => queryClient.invalidateQueries({ queryKey: toolsQueryKeys.templates }) });
}

function TemplateDialog({ template, onClose }: { readonly template: TextTemplateResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['profile', 'admin']);
  const [title, setTitle] = useState(template?.title ?? '');
  const [body, setBody] = useState(template?.bodyHtml ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useTemplateChange((client, value: { title: string; bodyHtml: string }) => saveTemplate(client, template?.id, value));
  return (
    <AdminDialog
      title={template === undefined ? t('templates.new') : t('templates.edit')}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (title.trim() !== '' && !isBlankRichText(body)) save.mutate({ title: title.trim(), bodyHtml: body }, { onSuccess: onClose });
      }}
    >
      <TextField label={t('templates.titleField')} required value={title} maxLength={TITLE_MAX} placeholder={t('templates.titlePlaceholder')} error={submitted && title.trim() === '' ? t('data.required') : undefined} onChange={(event) => setTitle(event.target.value)} />
      <RichTextEditor label={t('templates.body')} required value={body} maxLength={RICH_TEXT_MAX} minHeight={180} error={submitted && isBlankRichText(body) ? t('data.required') : undefined} onValueChange={setBody} />
    </AdminDialog>
  );
}

function ViewDialog({ template, onClose }: { readonly template: TextTemplateResponse; readonly onClose: () => void }) {
  const { t } = useTranslation(['profile', 'admin']);
  return (
    <Dialog open title={template.title} closeLabel={t('admin:dialog.close')} onClose={onClose} footer={<Button onClick={onClose}>{t('close')}</Button>}>
      <div className={styles.preview}>
        <RichText html={template.bodyHtml} />
      </div>
    </Dialog>
  );
}

/** Who may read the template; saved as a whole list. The owner always may and is not offered. */
function ShareDialog({ template, onClose }: { readonly template: TextTemplateResponse; readonly onClose: () => void }) {
  const { t } = useTranslation(['profile', 'admin']);
  const client = useApiClient();
  const me = useCurrentUser().data?.user.id;
  const saved = useQuery(templateSharesQueryOptions(client, template.id));
  const [draft, setDraft] = useState<readonly string[]>();
  const shared = draft ?? saved.data ?? [];
  const names = useQuery(directoryNamesQueryOptions(client, shared));
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (userIds: readonly string[]) => setTemplateShares(client, template.id, userIds),
    onSuccess: (userIds) => queryClient.setQueryData(toolsQueryKeys.templateShares(template.id), userIds),
  });
  const nameOf = (userId: string) => {
    const person = names.data?.find((candidate) => candidate.userId === userId);
    return person === undefined ? '…' : personName(person);
  };
  return (
    <AdminDialog title={t('templates.shareTitle', { name: template.title })} submitLabel={t('admin:dialog.save')} pending={save.isPending} error={null} onClose={onClose} onSubmit={() => save.mutate(shared, { onSuccess: onClose })}>
      <p className={styles.note}>{t('templates.shareHint')}</p>
      {saved.data === undefined ? (
        <p className={styles.note}>{saved.isError ? t('loadFailed') : t('loading')}</p>
      ) : shared.length === 0 ? (
        <p className={styles.note}>{t('templates.notShared')}</p>
      ) : (
        <ul className={styles.list} aria-label={t('templates.sharedWith')}>
          {shared.map((userId) => (
            <li key={userId} className={styles.row}>
              <span>{nameOf(userId)}</span>
              <Button variant="ghost" aria-label={t('templates.unshareNamed', { name: nameOf(userId) })} onClick={() => setDraft(shared.filter((id) => id !== userId))}>
                {t('remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <PersonPicker
        label={t('templates.shareWith')}
        actionLabel={t('add')}
        actionLabelNamed={(name) => t('templates.shareWithNamed', { name })}
        taken={new Set([...shared, ...(me === undefined ? [] : [me])])}
        onPick={(person) => setDraft([...shared, person.userId])}
      />
      {save.error !== null && <Alert tone="danger">{t('templates.shareFailed')}</Alert>}
    </AdminDialog>
  );
}

function DeleteDialog({ template, onClose }: { readonly template: TextTemplateResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('profile');
  const remove = useTemplateChange((client, templateId: string) => deleteTemplate(client, templateId));
  return (
    <AdminDialog title={t('templates.deleteTitle', { name: template.title })} submitLabel={t('delete')} pending={remove.isPending} error={null} onClose={onClose} onSubmit={() => remove.mutate(template.id, { onSuccess: onClose })}>
      <p className={styles.note}>{t('templates.deleteHint')}</p>
      <ProfileError error={remove.error} />
    </AdminDialog>
  );
}
