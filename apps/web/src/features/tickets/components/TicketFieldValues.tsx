import type { FormFieldResponse, TicketFormResponse, TicketValueNamesResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui';
import { type FieldValueDisplay, fieldValueDisplay } from '../lib/field-value';
import { LoadError } from './LoadError';
import { TableValueDialog } from './TableValueDialog';
import styles from './TicketFieldValues.module.css';

export interface TicketFieldValuesProps {
  readonly ticketId: string;
  readonly values: Readonly<Record<string, unknown>>;
  /** Names of the people and sites the values point to. */
  readonly valueNames: TicketValueNamesResponse;
  /** Column totals of the tables, by field code. */
  readonly totals: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** Names of the ticket's files, by id (for the file columns of a table). */
  readonly fileNames: Readonly<Record<string, string>>;
  readonly form: UseQueryResult<TicketFormResponse>;
  readonly timeZone: string | undefined;
}

/**
 * The values captured so far, labelled by the fields of the ticket's workflow version, in the builder's order. A table
 * reads as its number of rows, which opens the rows themselves.
 */
export function TicketFieldValues({ ticketId, values, valueNames, totals, fileNames, form, timeZone }: TicketFieldValuesProps) {
  const { t } = useTranslation('tickets');
  const [table, setTable] = useState<FormFieldResponse>();
  const rows = [...(form.data?.fields ?? [])]
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .flatMap((field) => {
      const display = fieldValueDisplay(field, values[field.code], valueNames, timeZone);
      return display === undefined ? [] : [{ field, display }];
    });

  return (
    <Card title={t('detail.fields.title')}>
      {form.isError ? (
        <LoadError error={form.error} onRetry={() => void form.refetch()} />
      ) : form.data === undefined ? (
        <p className={styles.muted}>{t('detail.fields.loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.muted}>{t('detail.fields.empty')}</p>
      ) : (
        <dl className={styles.values}>
          {rows.map(({ field, display }) => (
            <div key={field.id} className={styles.row}>
              <dt>{field.label}</dt>
              <dd>
                {display.kind === 'rows' && display.count > 0 ? (
                  <button type="button" className={styles.link} aria-label={t('detail.fields.showRows', { field: field.label })} onClick={() => setTable(field)}>
                    <DisplayedValue display={display} />
                  </button>
                ) : (
                  <DisplayedValue display={display} />
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {table !== undefined && (
        <TableValueDialog
          ticketId={ticketId}
          field={table}
          rows={Array.isArray(values[table.code]) ? (values[table.code] as Record<string, unknown>[]) : []}
          totals={totals[table.code]}
          fileNames={fileNames}
          timeZone={timeZone}
          onClose={() => setTable(undefined)}
        />
      )}
    </Card>
  );
}

/** A field's value as `fieldValueDisplay` reads it. */
export function DisplayedValue({ display }: { readonly display: FieldValueDisplay }) {
  const { t } = useTranslation('tickets');
  switch (display.kind) {
    case 'text':
      return display.text;
    case 'days':
      return t('detail.fields.days', { count: display.count });
    case 'rows':
      return t('detail.fields.rows', { count: display.count });
    case 'unknown':
      return <span className={styles.unknown}>{t('detail.fields.unknown')}</span>;
  }
}
