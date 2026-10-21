import { type SiteTreeNode, siteResponseSchema } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { saveAdminItem } from '@/shared/admin/admin-api';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { Checkbox, TextField } from '@/shared/ui';

const NAME_MAX = 200;

export interface SiteDialogProps {
  /** Where a new site goes; `undefined` for a root (or when editing). */
  readonly parent: SiteTreeNode | undefined;
  /** The site being edited; `undefined` for a new one. */
  readonly site: SiteTreeNode | undefined;
  readonly onClose: () => void;
}

/** A site: its name and whether it is the central one; a new site goes inside `parent`, one level below it. */
export function SiteDialog({ parent, site, onClose }: SiteDialogProps) {
  const { t } = useTranslation(['organization', 'admin']);
  const [name, setName] = useState(site?.name ?? '');
  const [isCentral, setIsCentral] = useState(site?.isCentral ?? false);
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, body: Record<string, unknown>) => saveAdminItem(client, '/sites', siteResponseSchema, site?.id, body));
  const title = site !== undefined ? t('sites.edit') : parent === undefined ? t('sites.new') : t('sites.newInside', { name: parent.name });
  return (
    <AdminDialog
      title={title}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() === '') return;
        save.mutate({ name: name.trim(), isCentral, ...(site === undefined && parent !== undefined ? { parentId: parent.id } : {}) }, { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
      <Checkbox label={t('sites.centralLabel')} checked={isCentral} onChange={(event) => setIsCentral(event.target.checked)} />
    </AdminDialog>
  );
}
