import type { ReportName } from '@procesabpm/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Alert, Button } from '@/shared/ui';
import { downloadReport, filterParams } from '../../api/reports-api';
import { periodProblem, type ReportFilters } from '../../lib/report-filters';
import { ReportError } from '../ReportState';
import styles from '../Reports.module.css';

const ITEMS = ['complete', 'tickets', 'sla-responsibles', 'comments', 'workflow-usage', 'backlog'] as const satisfies readonly ReportName[];
type Item = (typeof ITEMS)[number];

/** The help desk's report menu: workbooks with the filters above, one at a time. */
export function DownloadsTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const download = useMutation({ mutationFn: (item: Item) => downloadReport(client, item, filterParams(item === 'backlog' ? { ...filters, from: '', to: '' } : filters)) });
  const blocked = periodProblem(filters.from, filters.to) !== undefined;
  return (
    <div className={styles.stack}>
      <p className={styles.note}>{t('downloads.hint')}</p>
      {download.isPending && download.variables !== undefined && <Alert tone="info">{t('downloads.busy', { name: t(`downloads.items.${download.variables}.title`) })}</Alert>}
      {download.isError && <ReportError error={download.error} />}
      <div className={styles.downloads}>
        {ITEMS.map((item) => (
          <div key={item} className={styles.download}>
            <div>
              <h3 className={styles.downloadTitle}>{t(`downloads.items.${item}.title`)}</h3>
              <p className={styles.note}>{t(`downloads.items.${item}.body`)}</p>
            </div>
            <Button disabled={download.isPending || (blocked && item !== 'backlog')} onClick={() => download.mutate(item)}>
              {download.isPending && download.variables === item ? t('exporting') : t('downloads.download')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
