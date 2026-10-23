import type { ReportName } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { usePermissions, useApiClient } from '@/shared/session';
import { Button } from '@/shared/ui';
import { downloadReport, filterParams } from '../api/reports-api';
import type { ReportFilters } from '../lib/report-filters';
import { ReportError } from './ReportState';

export interface ExportButtonProps {
  readonly report: ReportName;
  readonly filters: ReportFilters;
  /** The report's own options (level, minimum volume, the person). */
  readonly extra?: Readonly<Record<string, string | number | undefined>>;
  readonly disabled?: boolean;
}

/** Downloads the report on screen as a workbook, for whoever may export reports. */
export function ExportButton({ report, filters, extra = {}, disabled = false }: ExportButtonProps) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const { can } = usePermissions();
  const download = useMutation({ mutationFn: () => downloadReport(client, report, filterParams(filters, extra)) });
  if (!can('export', 'Report')) return null;
  return (
    <span>
      <Button disabled={disabled || download.isPending} onClick={() => download.mutate()}>
        {download.isPending ? t('exporting') : t('export')}
      </Button>
      {download.isError && <ReportError error={download.error} />}
    </span>
  );
}
