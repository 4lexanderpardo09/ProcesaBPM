import type { ExportDefinitionResponse, ExportLineResponse } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { ticketPath } from '@/shared/lib/paths';
import { useApiClient } from '@/shared/session';
import { Table, type TableColumn } from '@/shared/ui';
import { pendingLinesQueryOptions } from '../api/exports-api';

/** The lines waiting for the next file, with the cells they will bring (the file columns are filled at the cutoff). */
export function ExportLinesTab({ definition }: { readonly definition: ExportDefinitionResponse }) {
  const { t } = useTranslation('workflows');
  const lines = useQuery(pendingLinesQueryOptions(useApiClient(), definition.id));
  const columns: TableColumn<ExportLineResponse>[] = [
    { key: 'ticket', header: t('exports.lines.ticket'), width: '110px', code: true, cell: (row) => <Link to={ticketPath(row.ticketId)}>{row.ticketNumber}</Link> },
    ...definition.columns.filter((column) => column.sourceType !== 'SEQUENCE' && column.sourceType !== 'CUTOFF_DATE').map((column) => ({ key: `column:${column.header}`, header: column.header, cell: (row: ExportLineResponse) => row.data[column.header] ?? '' })),
  ];
  return <Table label={t('exports.lines.label')} columns={columns} rows={lines.data ?? []} rowKey={(row) => row.id} loading={lines.data === undefined} empty={t('exports.lines.empty')} />;
}
