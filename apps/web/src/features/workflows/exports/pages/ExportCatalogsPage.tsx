import { exportCatalogNameSchema } from '@procesabpm/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paths } from '@/shared/lib/paths';
import { useApiClient, usePermissions } from '@/shared/session';
import { Alert, Breadcrumb, Button, Card, PageHeader, PlusIcon, Select, TextField } from '@/shared/ui';
import { WorkflowError } from '../../components/WorkflowError';
import { catalogNamesQueryOptions, catalogQueryOptions, exportQueryKeys, saveCatalog } from '../api/exports-api';
import styles from '../components/Exports.module.css';

interface Entry {
  readonly inputValue: string;
  readonly outputValue: string;
}

/** The translation tables of CATALOG columns: choose one (or name a new one) and edit its rows. */
export function ExportCatalogsPage() {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const names = useQuery(catalogNamesQueryOptions(client));
  const [open, setOpen] = useState('');
  const [newName, setNewName] = useState('');
  const validNew = exportCatalogNameSchema.safeParse(newName.trim()).success;
  return (
    <>
      <Breadcrumb label={t('detail.breadcrumb')} items={[{ label: t('detail.back'), to: paths.workflows }, { label: t('exports.breadcrumb'), to: paths.exports }, { label: t('exports.catalogs') }]} />
      <PageHeader title={t('exports.catalogsPage.title')} subtitle={t('exports.catalogsPage.subtitle')} />
      <div className={styles.form}>
        <div className={styles.grid}>
          <Select label={t('exports.catalogsPage.choose')} placeholder="—" options={(names.data ?? []).map((name) => ({ value: name, label: name }))} value={open} onChange={(event) => setOpen(event.target.value)} />
          <TextField label={t('exports.catalogsPage.newName')} hint={t('exports.catalogsPage.newNameHint')} value={newName} maxLength={50} onChange={(event) => setNewName(event.target.value)} />
          <div className={styles.buttons}>
            <Button
              disabled={!validNew}
              onClick={() => {
                setOpen(newName.trim());
                setNewName('');
              }}
            >
              {t('exports.catalogsPage.open')}
            </Button>
          </div>
        </div>
        {open !== '' && <CatalogEditor key={open} name={open} />}
      </div>
    </>
  );
}

function CatalogEditor({ name }: { readonly name: string }) {
  const { t } = useTranslation('workflows');
  const client = useApiClient();
  const queryClient = useQueryClient();
  const canEdit = usePermissions().can('update', 'Export');
  const catalog = useQuery(catalogQueryOptions(client, name));
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [saved, setSaved] = useState(false);
  const rows = entries ?? catalog.data?.entries ?? [];
  const save = useMutation({
    mutationFn: (body: readonly Entry[]) => saveCatalog(client, name, { entries: body.map((entry) => ({ inputValue: entry.inputValue.trim(), outputValue: entry.outputValue.trim() })) }),
    onSuccess: async (result) => {
      setEntries(result.entries);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: exportQueryKeys.catalogs });
    },
  });
  const edit = (next: Entry[]) => {
    setSaved(false);
    setEntries(next);
  };
  const filled = rows.filter((entry) => entry.inputValue.trim() !== '');
  const duplicate = new Set(filled.map((entry) => entry.inputValue.trim().toLowerCase())).size !== filled.length;
  if (catalog.data === undefined && entries === null) return <p className={styles.note}>{catalog.isError ? t('loadFailed') : t('loading')}</p>;
  return (
    <Card
      title={name}
      actions={
        canEdit ? (
          <Button icon={<PlusIcon size={15} />} onClick={() => edit([...rows, { inputValue: '', outputValue: '' }])}>
            {t('exports.catalogsPage.add')}
          </Button>
        ) : undefined
      }
    >
      <div className={styles.form}>
        {rows.length === 0 && <p className={styles.note}>{t('exports.catalogsPage.empty')}</p>}
        {rows.map((entry, index) => (
          <fieldset key={index} className={`${styles.item} ${styles.rule}`} disabled={!canEdit}>
            <TextField label={t('exports.catalogsPage.input')} value={entry.inputValue} maxLength={500} onChange={(event) => edit(rows.map((row, at) => (at === index ? { ...row, inputValue: event.target.value } : row)))} />
            <TextField label={t('exports.catalogsPage.output')} value={entry.outputValue} maxLength={500} onChange={(event) => edit(rows.map((row, at) => (at === index ? { ...row, outputValue: event.target.value } : row)))} />
            <span />
            <Button variant="ghost" aria-label={t('exports.catalogsPage.remove', { number: index + 1 })} onClick={() => edit(rows.filter((_, at) => at !== index))}>
              {t('remove')}
            </Button>
          </fieldset>
        ))}
        {duplicate && <Alert tone="warn">{t('exports.catalogsPage.duplicate')}</Alert>}
        <WorkflowError error={save.error} context="content" />
        {saved && <Alert tone="ok">{t('exports.catalogsPage.saved')}</Alert>}
        {canEdit && (
          <div className={styles.buttons}>
            <Button variant="brand" disabled={save.isPending || duplicate} onClick={() => save.mutate(filled)}>
              {save.isPending ? t('saving') : t('exports.catalogsPage.save')}
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
