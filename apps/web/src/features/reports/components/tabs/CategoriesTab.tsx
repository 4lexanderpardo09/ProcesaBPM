import type { CategoryRow } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/shared/session';
import { Table } from '@/shared/ui';
import { categoriesQuery, type TicketDrill } from '../../api/reports-api';
import { formatCount, useFormatMinutes } from '../../lib/report-format';
import type { ReportFilters } from '../../lib/report-filters';
import { Bar } from '../Bar';
import { ExportButton } from '../ExportButton';
import { ReportState } from '../ReportState';
import { ReportTicketsDialog } from '../ReportTicketsDialog';
import styles from '../Reports.module.css';

/** Which categories and subcategories bring the most tickets and take the longest; a category opens to its subcategories. */
export function CategoriesTab({ filters }: { readonly filters: ReportFilters }) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const minutes = useFormatMinutes();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [drill, setDrill] = useState<{ title: string; drill: TicketDrill }>();
  const report = useQuery(categoriesQuery(client, filters));
  const toggle = (id: string) => setOpen((current) => (current.has(id) ? new Set([...current].filter((other) => other !== id)) : new Set([...current, id])));
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <span />
        <ExportButton report="categories" filters={filters} />
      </div>
      <ReportState query={report}>
        {(rows) => {
          const most = Math.max(1, ...rows.filter((row) => row.subcategoryId === null).map((row) => row.created));
          const visible = rows.filter((row) => row.subcategoryId === null || open.has(row.categoryId));
          return (
            <Table<CategoryRow>
              label={t('tabs.categories')}
              rows={visible}
              rowKey={(row) => `${row.categoryId}:${row.subcategoryId ?? ''}`}
              empty={t('empty')}
              columns={[
                {
                  key: 'name',
                  header: t('categories.category'),
                  cell: (row) =>
                    row.subcategoryId === null ? (
                      <span>
                        <button type="button" className={styles.linkButton} aria-expanded={open.has(row.categoryId)} aria-label={t(open.has(row.categoryId) ? 'categories.collapse' : 'categories.expand', { name: row.categoryName })} onClick={() => toggle(row.categoryId)}>
                          {open.has(row.categoryId) ? '▾' : '▸'}
                        </button>{' '}
                        <button type="button" className={styles.linkButton} onClick={() => setDrill({ title: t('tickets.of.category', { name: row.categoryName }), drill: { categoryId: row.categoryId } })}>
                          {row.categoryName}
                        </button>
                      </span>
                    ) : (
                      <span className={styles.sub}>
                        <button type="button" className={styles.linkButton} onClick={() => setDrill({ title: t('tickets.of.category', { name: row.subcategoryName ?? '' }), drill: { subcategoryId: row.subcategoryId ?? '' } })}>
                          {row.subcategoryName}
                        </button>
                      </span>
                    ),
                },
                { key: 'created', header: t('categories.created'), width: '200px', cell: (row) => (row.subcategoryId === null ? <Bar share={row.created / most} label={formatCount(row.created)} /> : formatCount(row.created)) },
                { key: 'open', header: t('categories.open'), code: true, width: '90px', cell: (row) => formatCount(row.open) },
                { key: 'closed', header: t('categories.closed'), code: true, width: '90px', cell: (row) => formatCount(row.closed) },
                { key: 'avg', header: t('categories.avg'), width: '190px', cell: (row) => minutes(row.avgResolutionMin) },
              ]}
            />
          );
        }}
      </ReportState>
      {drill !== undefined && <ReportTicketsDialog title={drill.title} filters={filters} drill={drill.drill} onClose={() => setDrill(undefined)} />}
    </div>
  );
}
