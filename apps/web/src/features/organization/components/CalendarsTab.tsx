import type { CalendarResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AdminDialog } from '@/shared/admin/AdminDialog';
import { useAdminMutation } from '@/shared/admin/use-admin-mutation';
import { useApiClient, usePermissions } from '@/shared/session';
import { Badge, Button, PlusIcon, Table } from '@/shared/ui';
import { calendarsQueryOptions, countriesQueryOptions, deleteCalendar } from '../api/organization-api';
import { CalendarDialog } from './CalendarDialog';
import { DueDatePreviewCard } from './DueDatePreviewCard';
import { HolidaysCard } from './HolidaysCard';
import { WorkingHoursCard } from './WorkingHoursCard';
import adminStyles from '@/shared/admin/Admin.module.css';
import styles from './Organization.module.css';

type Dialog = { readonly kind: 'create' } | { readonly kind: 'edit' | 'delete'; readonly calendar: CalendarResponse } | null;

/**
 * The calendars an SLA is counted on: the working hours of each weekday and the holidays. Each company uses one (the
 * default calendar if it has none); below the list, the one chosen with its hours, holidays and a deadline preview.
 */
export function CalendarsTab() {
  const { t } = useTranslation(['organization', 'admin']);
  const { can } = usePermissions();
  const client = useApiClient();
  const calendars = useQuery(calendarsQueryOptions(client));
  const countries = useQuery(countriesQueryOptions(client));
  const [chosenId, setChosenId] = useState<string>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const chosen = calendars.data?.find((calendar) => calendar.id === chosenId) ?? calendars.data?.find((calendar) => calendar.isDefault) ?? calendars.data?.[0];
  const countryName = (code: string | null) => (code === null ? t('calendars.noCountry') : (countries.data?.find((country) => country.code === code)?.name ?? code));
  const canUpdate = can('update', 'Calendar');
  const canDelete = can('delete', 'Calendar');

  return (
    <div className={styles.stack}>
      {can('create', 'Calendar') && (
        <div className={adminStyles.toolbar}>
          <div className={adminStyles.toolbarEnd}>
            <Button variant="primary" icon={<PlusIcon size={15} />} onClick={() => setDialog({ kind: 'create' })}>
              {t('calendars.new')}
            </Button>
          </div>
        </div>
      )}
      <Table<CalendarResponse>
        label={t('calendars.title')}
        rows={calendars.data ?? []}
        rowKey={(row) => row.id}
        loading={calendars.data === undefined && !calendars.isError}
        loadingLabel={t('admin:list.loading')}
        empty={calendars.isError ? t('admin:list.failed') : t('calendars.empty')}
        columns={[
          {
            key: 'name',
            header: t('admin:fields.name'),
            cell: (row) => (
              <span className={styles.name}>
                {row.name}
                {row.isDefault && <Badge tone="accent">{t('calendars.default')}</Badge>}
                {row.id === chosen?.id && <Badge tone="ok">{t('calendars.shown')}</Badge>}
              </span>
            ),
          },
          { key: 'country', header: t('calendars.country'), width: '170px', cell: (row) => countryName(row.countryCode) },
          {
            key: 'actions',
            header: t('admin:list.actions'),
            cell: (row) => (
              <div className={adminStyles.rowActions}>
                {row.id !== chosen?.id && (
                  <Button variant="ghost" aria-label={t('calendars.showNamed', { name: row.name })} onClick={() => setChosenId(row.id)}>
                    {t('calendars.show')}
                  </Button>
                )}
                {canUpdate && (
                  <Button variant="ghost" aria-label={t('admin:list.editNamed', { name: row.name })} onClick={() => setDialog({ kind: 'edit', calendar: row })}>
                    {t('admin:list.edit')}
                  </Button>
                )}
                {canDelete && !row.isDefault && (
                  <Button variant="ghost" aria-label={t('calendars.deleteNamed', { name: row.name })} onClick={() => setDialog({ kind: 'delete', calendar: row })}>
                    {t('calendars.delete')}
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
      {chosen !== undefined && (
        <>
          <h2 className={styles.sectionTitle}>{t('calendars.detailTitle', { name: chosen.name })}</h2>
          <div className={styles.calendarGrid}>
            <WorkingHoursCard key={`hours-${chosen.id}`} calendarId={chosen.id} canEdit={canUpdate} />
            <HolidaysCard key={`holidays-${chosen.id}`} calendar={chosen} countryName={countryName(chosen.countryCode)} canEdit={canUpdate} />
          </div>
          <DueDatePreviewCard key={`preview-${chosen.id}`} calendarId={chosen.id} />
        </>
      )}
      {dialog?.kind === 'create' && <CalendarDialog record={undefined} onClose={() => setDialog(null)} onCreated={(created) => setChosenId(created.id)} />}
      {dialog?.kind === 'edit' && <CalendarDialog record={dialog.calendar} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && <DeleteCalendarDialog calendar={dialog.calendar} onClose={() => setDialog(null)} />}
    </div>
  );
}

function DeleteCalendarDialog({ calendar, onClose }: { readonly calendar: CalendarResponse; readonly onClose: () => void }) {
  const { t } = useTranslation('organization');
  const remove = useAdminMutation((client, calendarId: string) => deleteCalendar(client, calendarId));
  return (
    <AdminDialog title={t('calendars.deleteTitle', { name: calendar.name })} submitLabel={t('calendars.delete')} pending={remove.isPending} error={remove.error} onClose={onClose} onSubmit={() => remove.mutate(calendar.id, { onSuccess: onClose })}>
      <p className={styles.note}>{t('calendars.deleteHint')}</p>
    </AdminDialog>
  );
}
