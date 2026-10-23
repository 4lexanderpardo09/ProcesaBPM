import { BATCH_GROUP_BY, type BatchGroupBy, type FieldDocument, MAX_BATCH_TICKETS } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Select, TextField } from '@/shared/ui';
import { WholeNumberField } from './WholeNumberField';

export interface BatchConfig {
  readonly maxTickets?: number;
  readonly title?: string;
  readonly showFields?: readonly string[];
  readonly groupBy?: BatchGroupBy;
}

/** How many data the tray shows beside each ticket. */
const MAX_SHOWN = 4;
/** Values that need the ticket's names (people, sites) or are not one value (files, tables) are not shown in the tray. */
const HIDDEN_TYPES: ReadonlySet<string> = new Set(['FILE', 'TABLE', 'USER', 'SITE']);

/** A field the tray can show: one value that reads by itself (a list from presets holds ids, so it is left out). */
const showable = (field: FieldDocument) => !HIDDEN_TYPES.has(field.type) && field.dataSource === null;

/**
 * The step's batch tray: how many tickets go in one batch, its title, up to four data of each ticket beside it and how
 * it splits them. Only the limit is required by the API; with any other setting and no limit, the most a request takes.
 */
export function BatchSettings({ batch, fields, readOnly, onChange }: { readonly batch: BatchConfig | undefined; readonly fields: readonly FieldDocument[]; readonly readOnly: boolean; readonly onChange: (batch: BatchConfig | undefined) => void }) {
  const { t } = useTranslation('workflows');
  const current = batch ?? {};
  const shown = current.showFields ?? [];
  const set = (patch: { readonly [K in keyof BatchConfig]?: BatchConfig[K] | undefined }) => {
    const next = Object.fromEntries(Object.entries({ ...current, ...patch }).filter(([, value]) => value !== undefined)) as BatchConfig;
    const { maxTickets, ...rest } = next;
    onChange(Object.keys(rest).length === 0 && maxTickets === undefined ? undefined : { ...next, maxTickets: maxTickets ?? MAX_BATCH_TICKETS });
  };
  const setShown = (codes: readonly string[]) => set({ showFields: codes.length === 0 ? undefined : codes });
  const candidates = fields.filter(showable);
  const slots = shown.length < MAX_SHOWN ? [...shown, ''] : shown;

  return (
    <>
      <WholeNumberField label={t('builder.batch.max')} min={1} max={500} disabled={readOnly} value={current.maxTickets ?? null} onChange={(value) => set({ maxTickets: value ?? undefined })} />
      <TextField label={t('builder.batch.trayTitle')} hint={t('builder.batch.trayTitleHint')} maxLength={120} disabled={readOnly} value={current.title ?? ''} onChange={(event) => set({ title: event.target.value.trim() === '' ? undefined : event.target.value })} />
      <Select
        label={t('builder.batch.groupBy')}
        disabled={readOnly}
        placeholder={t('builder.batch.noGroup')}
        options={BATCH_GROUP_BY.map((value) => ({ value, label: t(`builder.batch.groups.${value}`) }))}
        value={current.groupBy ?? ''}
        onChange={(event) => set({ groupBy: event.target.value === '' ? undefined : (event.target.value as BatchGroupBy) })}
      />
      {slots.map((code, index) => (
        <Select
          key={`${String(index)}:${code}`}
          label={t('builder.batch.shownField', { number: index + 1 })}
          {...(index === 0 ? { hint: t('builder.batch.shownFieldsHint', { max: MAX_SHOWN }) } : {})}
          disabled={readOnly}
          placeholder={t('builder.batch.noField')}
          options={candidates.filter((field) => field.code === code || !shown.includes(field.code)).map((field) => ({ value: field.code, label: `${field.label} (${field.code})` }))}
          value={code}
          onChange={(event) => setShown(event.target.value === '' ? shown.filter((_, at) => at !== index) : index < shown.length ? shown.map((old, at) => (at === index ? event.target.value : old)) : [...shown, event.target.value])}
        />
      ))}
    </>
  );
}
