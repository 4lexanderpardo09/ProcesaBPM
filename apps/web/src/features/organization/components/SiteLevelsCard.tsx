import type { SiteLevelResponse } from '@procesabpm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { Button, Card, TextField } from '@/shared/ui';
import { saveSiteLevel } from '../api/organization-api';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

const NAME_MAX = 200;

export interface SiteLevelsCardProps {
  readonly levels: readonly SiteLevelResponse[];
  /** The levels the tree has; the names go in order from 1, so only the next unnamed one can be named. */
  readonly usedLevels: readonly number[];
  readonly canEdit: boolean;
}

/** What the organization calls each level of its tree ("Regional", "Sede", "Punto de venta"…), shown instead of "Nivel 2". */
export function SiteLevelsCard({ levels, usedLevels, canEdit }: SiteLevelsCardProps) {
  const { t } = useTranslation(['organization', 'admin']);
  const [editing, setEditing] = useState<number>();
  const deepest = Math.max(0, ...usedLevels, ...levels.map((level) => level.level));
  const shown = Array.from({ length: deepest + 1 }, (_, index) => index + 1);
  const nameOf = (level: number) => levels.find((candidate) => candidate.level === level)?.name;
  return (
    <Card title={t('sites.levels.title')}>
      <p className={styles.note}>{t('sites.levels.hint')}</p>
      <ul className={styles.levels}>
        {shown.map((level) => (
          <li key={level} className={styles.levelRow}>
            <span className={styles.levelNumber}>{t('sites.level', { level })}</span>
            <span>{nameOf(level) ?? '—'}</span>
            {/* Levels are named in order, without gaps: the API refuses to skip one. */}
            {canEdit && level <= levels.length + 1 && (
              <div className={adminStyles.rowActions}>
                <Button variant="ghost" aria-label={t('sites.levels.nameLevel', { level })} onClick={() => setEditing(level)}>
                  {t('admin:list.edit')}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing !== undefined && <LevelDialog level={editing} current={nameOf(editing)} onClose={() => setEditing(undefined)} />}
    </Card>
  );
}

function LevelDialog({ level, current, onClose }: { readonly level: number; readonly current: string | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation(['organization', 'admin']);
  const [name, setName] = useState(current ?? '');
  const [submitted, setSubmitted] = useState(false);
  const save = useAdminMutation((client, value: string) => saveSiteLevel(client, level, value));
  return (
    <AdminDialog
      title={t('sites.levels.nameLevel', { level })}
      submitLabel={t('admin:dialog.save')}
      pending={save.isPending}
      error={save.error}
      onClose={onClose}
      onSubmit={() => {
        setSubmitted(true);
        if (name.trim() !== '') save.mutate(name.trim(), { onSuccess: onClose });
      }}
    >
      <TextField label={t('admin:fields.name')} required value={name} maxLength={NAME_MAX} placeholder={t('sites.levels.placeholder')} error={submitted && name.trim() === '' ? t('admin:fields.nameRequired') : undefined} onChange={(event) => setName(event.target.value)} />
    </AdminDialog>
  );
}
