import type { SiteTreeNode } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { Select } from '@/shared/ui';
import { moveSite } from '../api/organization-api';
import { flattenSites, subtreeIds } from '../lib/site-tree';

const ROOT = 'root';

/** Puts the site (with everything under it) inside another one, or at the top; never inside itself or its own branch. */
export function MoveSiteDialog({ site, roots, onClose }: { readonly site: SiteTreeNode; readonly roots: readonly SiteTreeNode[]; readonly onClose: () => void }) {
  const { t } = useTranslation(['organization', 'admin']);
  const [parentId, setParentId] = useState(site.parentId ?? ROOT);
  const move = useAdminMutation((client, target: string | null) => moveSite(client, site.id, target));
  const excluded = subtreeIds(site);
  const options = [
    { value: ROOT, label: t('sites.atRoot') },
    ...flattenSites(roots)
      .filter((row) => row.site.isActive && !excluded.has(row.site.id))
      .map((row) => ({ value: row.site.id, label: `${'— '.repeat(row.depth)}${row.site.name}` })),
  ];
  return (
    <AdminDialog title={t('sites.moveTitle', { name: site.name })} submitLabel={t('sites.move')} pending={move.isPending} error={move.error} onClose={onClose} onSubmit={() => move.mutate(parentId === ROOT ? null : parentId, { onSuccess: onClose })}>
      <Select label={t('sites.newParent')} hint={t('sites.moveHint')} value={parentId} options={options} onChange={(event) => setParentId(event.target.value)} />
    </AdminDialog>
  );
}
