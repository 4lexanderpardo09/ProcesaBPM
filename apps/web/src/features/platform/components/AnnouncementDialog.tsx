import type { AnnouncementRequest, PlatformAnnouncementResponse } from '@procesabpm/shared';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/shared/lib/use-debounced-value';
import { Button, Checkbox, Dialog, Select, TextArea, TextField } from '@/shared/ui';
import { platformQueryKeys, saveAnnouncement, tenantQueryOptions, tenantsQueryOptions } from '../api/platform-api';
import { usePlatformClient } from '../session/PlatformSessionContext';
import { PlatformError } from './PlatformError';
import styles from '../pages/Platform.module.css';

const TYPES = ['MAINTENANCE', 'RELEASE_NOTES', 'INFO'] as const;
const AUDIENCES = ['ALL', 'TENANTS'] as const;
/** Organizations offered per search: the person narrows it by typing. */
const SEARCH_SIZE = 20;

/** An ISO instant as a `datetime-local` value in the browser's time zone, and back. */
function toLocal(iso: string): string {
  const date = new Date(iso);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const fromLocal = (value: string): string | undefined => (value === '' || Number.isNaN(new Date(value).getTime()) ? undefined : new Date(value).toISOString());

/**
 * A new announcement or a change to one: its kind, text, when it is shown, whether it keeps people out while it lasts,
 * and for whom (every organization, or the ones chosen by searching).
 */
export function AnnouncementDialog({ announcement, onClose }: { readonly announcement: PlatformAnnouncementResponse | undefined; readonly onClose: () => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const queryClient = useQueryClient();
  const [type, setType] = useState<AnnouncementRequest['type']>(announcement?.type ?? 'INFO');
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body ?? '');
  const [startsAt, setStartsAt] = useState(toLocal(announcement?.startsAt ?? new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(announcement?.endsAt === null || announcement?.endsAt === undefined ? '' : toLocal(announcement.endsAt));
  const [blocksLogin, setBlocksLogin] = useState(announcement?.blocksLogin ?? false);
  const [audience, setAudience] = useState<AnnouncementRequest['audience']>(announcement?.audience ?? 'ALL');
  const [tenantIds, setTenantIds] = useState<readonly string[]>(announcement?.tenantIds ?? []);
  const [submitted, setSubmitted] = useState(false);

  const start = fromLocal(startsAt);
  const end = fromLocal(endsAt);
  const endsBeforeStart = start !== undefined && end !== undefined && new Date(end) <= new Date(start);
  const valid = title.trim() !== '' && body.trim() !== '' && start !== undefined && !endsBeforeStart && (audience === 'ALL' || tenantIds.length > 0);
  const save = useMutation({
    mutationFn: () =>
      saveAnnouncement(client, announcement?.id, { type, title: title.trim(), body: body.trim(), startsAt: start!, endsAt: end ?? null, blocksLogin, audience, tenantIds: audience === 'ALL' ? [] : [...tenantIds] }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: platformQueryKeys.announcements() });
      onClose();
    },
  });
  const required = (value: string) => (submitted && value.trim() === '' ? t('announcements.form.required') : undefined);

  return (
    <Dialog
      open
      title={announcement === undefined ? t('announcements.form.newTitle') : t('announcements.form.editTitle')}
      closeLabel={t('close')}
      onClose={onClose}
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (valid && !save.isPending) save.mutate();
      }}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            {save.isPending ? t('saving') : t('save')}
          </Button>
        </>
      }
    >
      <div className={styles.stack}>
        <Select label={t('announcements.form.type')} options={TYPES.map((value) => ({ value, label: t(`announcements.types.${value}`) }))} value={type} onChange={(event) => setType(event.target.value as AnnouncementRequest['type'])} />
        <TextField label={t('announcements.form.title')} required maxLength={200} error={required(title)} value={title} onChange={(event) => setTitle(event.target.value)} />
        <TextArea label={t('announcements.form.body')} required maxLength={5000} error={required(body)} value={body} onChange={(event) => setBody(event.target.value)} />
        <TextField label={t('announcements.form.startsAt')} type="datetime-local" required error={submitted && start === undefined ? t('announcements.form.required') : undefined} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
        <TextField label={t('announcements.form.endsAt')} type="datetime-local" error={submitted && endsBeforeStart ? t('announcements.form.endsBeforeStart') : undefined} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
        <Checkbox label={t('announcements.form.blocksLogin')} checked={blocksLogin} onChange={(event) => setBlocksLogin(event.target.checked)} />
        <Select label={t('announcements.form.audience')} options={AUDIENCES.map((value) => ({ value, label: t(`announcements.form.audiences.${value}`) }))} value={audience} onChange={(event) => setAudience(event.target.value as AnnouncementRequest['audience'])} />
        {audience === 'TENANTS' && <TenantChoice selected={tenantIds} error={submitted && tenantIds.length === 0 ? t('announcements.form.tenantsNone') : undefined} onChange={setTenantIds} />}
        {save.isError && <PlatformError error={save.error} />}
      </div>
    </Dialog>
  );
}

/** The organizations an announcement is for: the chosen ones by name, and a search to add more. */
function TenantChoice({ selected, error, onChange }: { readonly selected: readonly string[]; readonly error: string | undefined; readonly onChange: (ids: readonly string[]) => void }) {
  const { t } = useTranslation('platform');
  const client = usePlatformClient();
  const [search, setSearch] = useState('');
  const term = useDebouncedValue(search.trim(), 300);
  const found = useQuery({ ...tenantsQueryOptions(client, { pageSize: SEARCH_SIZE, ...(term === '' ? {} : { search: term }) }) });
  // The names of the chosen ones the search did not bring (an announcement opened to change it).
  const named = new Map((found.data?.items ?? []).map((tenant) => [tenant.tenantId, tenant.name]));
  const details = useQueries({ queries: selected.filter((id) => !named.has(id)).map((id) => ({ ...tenantQueryOptions(client, id), retry: false })) });
  for (const detail of details) if (detail.data !== undefined) named.set(detail.data.tenantId, detail.data.name);
  const toggle = (id: string, on: boolean) => onChange(on ? [...selected, id] : selected.filter((current) => current !== id));

  return (
    <fieldset className={styles.group} aria-invalid={error !== undefined}>
      <legend>{t('announcements.form.tenants')}</legend>
      {selected.map((id) => (
        <Checkbox key={id} label={named.get(id) ?? t('announcements.form.tenantGone')} checked onChange={() => toggle(id, false)} />
      ))}
      <TextField label={t('announcements.form.tenantsSearch')} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
      {(found.data?.items ?? [])
        .filter((tenant) => !selected.includes(tenant.tenantId))
        .map((tenant) => (
          <Checkbox key={tenant.tenantId} label={`${tenant.name} (${tenant.slug})`} checked={false} onChange={() => toggle(tenant.tenantId, true)} />
        ))}
      {error !== undefined && <p className={styles.error}>{error}</p>}
    </fieldset>
  );
}
