import { type SiteTreeNode } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setAdminItemActive } from '@/shared/admin/admin-api';
import { AdminError } from '@/shared/admin/AdminError';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient, usePermissions } from '@/shared/session';
import { Badge, Button, Checkbox, PlusIcon, Table } from '@/shared/ui';
import { siteLevelsQueryOptions, siteTreeQueryOptions } from '../api/organization-api';
import { flattenSites, type SiteRow } from '../lib/site-tree';
import { MoveSiteDialog } from './MoveSiteDialog';
import { SiteDialog } from './SiteDialog';
import { SiteLevelsCard } from './SiteLevelsCard';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

type Dialog = { readonly kind: 'create'; readonly parent: SiteTreeNode | undefined } | { readonly kind: 'edit' | 'move'; readonly site: SiteTreeNode } | null;

/**
 * The sites as a tree (a regional office, its branches…): a step can limit its candidates to the ticket's site or its
 * parents, so the tree decides who can be assigned. Each level can have its own name.
 */
export function SitesTab() {
  const { t } = useTranslation(['organization', 'admin']);
  const { can } = usePermissions();
  const client = useApiClient();
  const [includeInactive, setIncludeInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const tree = useQuery(siteTreeQueryOptions(client, includeInactive));
  const levels = useQuery(siteLevelsQueryOptions(client));
  const toggle = useAdminMutation((c, site: SiteTreeNode) => setAdminItemActive(c, '/sites', site.id, !site.isActive));
  const levelName = (level: number) => levels.data?.find((candidate) => candidate.level === level)?.name ?? t('sites.level', { level });
  const rows = flattenSites(tree.data ?? []);
  const canCreate = can('create', 'Site');
  const canUpdate = can('update', 'Site');
  const canToggle = canUpdate && can('delete', 'Site');

  return (
    <div className={styles.stack}>
      <div className={adminStyles.toolbar}>
        <Checkbox label={t('admin:list.showInactive')} checked={includeInactive} onChange={(event) => setIncludeInactive(event.target.checked)} />
        {canCreate && (
          <div className={adminStyles.toolbarEnd}>
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setDialog({ kind: 'create', parent: undefined })}>
              {t('sites.new')}
            </Button>
          </div>
        )}
      </div>
      <AdminError error={toggle.error} />
      <Table<SiteRow>
        label={t('sites.title')}
        rows={rows}
        rowKey={(row) => row.site.id}
        loading={tree.data === undefined && !tree.isError}
        loadingLabel={t('admin:list.loading')}
        empty={tree.isError ? t('admin:list.failed') : t('sites.empty')}
        columns={[
          {
            key: 'name',
            header: t('admin:fields.name'),
            cell: ({ site, depth }) => (
              <span className={styles.name} style={{ paddingLeft: `calc(${depth} * var(--space-5))` }}>
                {depth > 0 && <span className={styles.branch} aria-hidden="true">└</span>}
                {site.name}
                {site.isCentral && <Badge tone="accent">{t('sites.central')}</Badge>}
              </span>
            ),
          },
          { key: 'level', header: t('sites.levelColumn'), width: '150px', cell: ({ site }) => levelName(site.level) },
          { key: 'status', header: t('admin:list.status'), width: '110px', cell: ({ site }) => (site.isActive ? <Badge tone="ok">{t('admin:list.active')}</Badge> : <Badge>{t('admin:list.inactive')}</Badge>) },
          {
            key: 'actions',
            header: t('admin:list.actions'),
            cell: ({ site }) => (
              <div className={adminStyles.rowActions}>
                {canCreate && site.isActive && (
                  <Button variant="ghost" aria-label={t('sites.addInsideNamed', { name: site.name })} onClick={() => setDialog({ kind: 'create', parent: site })}>
                    {t('sites.addInside')}
                  </Button>
                )}
                {canUpdate && (
                  <Button variant="ghost" aria-label={t('admin:list.editNamed', { name: site.name })} onClick={() => setDialog({ kind: 'edit', site })}>
                    {t('admin:list.edit')}
                  </Button>
                )}
                {canUpdate && (
                  <Button variant="ghost" aria-label={t('sites.moveNamed', { name: site.name })} onClick={() => setDialog({ kind: 'move', site })}>
                    {t('sites.move')}
                  </Button>
                )}
                {canToggle && (
                  <Button variant="ghost" aria-label={t(site.isActive ? 'admin:list.deactivateNamed' : 'admin:list.activateNamed', { name: site.name })} disabled={toggle.isPending} onClick={() => toggle.mutate(site)}>
                    {site.isActive ? t('admin:list.deactivate') : t('admin:list.activate')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      <SiteLevelsCard levels={levels.data ?? []} usedLevels={rows.map((row) => row.site.level)} canEdit={canUpdate} />
      {dialog?.kind === 'create' && <SiteDialog parent={dialog.parent} site={undefined} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <SiteDialog parent={undefined} site={dialog.site} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'move' && <MoveSiteDialog site={dialog.site} roots={tree.data ?? []} onClose={() => setDialog(null)} />}
    </div>
  );
}
