import { MAX_REPORT_DAYS } from '@procesabpm/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { companiesQueryOptions, departmentsQueryOptions, sitesQueryOptions } from '@/features/people';
import { useApiClient } from '@/shared/session';
import { Alert, Select, TextField } from '@/shared/ui';
import { workflowOptionsQuery } from '../api/reports-api';
import { periodProblem, type ReportFilters } from '../lib/report-filters';
import styles from './Reports.module.css';

export interface ReportFiltersBarProps {
  readonly filters: ReportFilters;
  readonly onChange: (filters: ReportFilters) => void;
}

/** The period and the filters every report shares, in one row above them. A period that cannot be asked is said, not sent. */
export function ReportFiltersBar({ filters, onChange }: ReportFiltersBarProps) {
  const { t } = useTranslation('reports');
  const client = useApiClient();
  const companies = useQuery(companiesQueryOptions(client));
  const workflows = useQuery(workflowOptionsQuery(client));
  const departments = useQuery(departmentsQueryOptions(client));
  const sites = useQuery(sitesQueryOptions(client));
  const set = (changes: Partial<ReportFilters>) => onChange({ ...filters, ...changes });
  const problem = periodProblem(filters.from, filters.to);
  const options = (items: ReadonlyArray<{ id: string; name: string }> | undefined) => (items ?? []).map((item) => ({ value: item.id, label: item.name }));
  return (
    <section aria-label={t('filters.label')}>
      <div className={styles.filters}>
        <TextField label={t('filters.from')} type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => set({ from: event.target.value })} />
        <TextField label={t('filters.to')} type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => set({ to: event.target.value })} />
        <Select label={t('filters.company')} placeholder={t('filters.allFemale')} options={options(companies.data)} value={filters.companyId} onChange={(event) => set({ companyId: event.target.value })} />
        <Select label={t('filters.workflow')} placeholder={t('filters.all')} options={options(workflows.data)} value={filters.workflowId} onChange={(event) => set({ workflowId: event.target.value })} />
        <Select label={t('filters.department')} placeholder={t('filters.all')} options={options(departments.data)} value={filters.departmentId} onChange={(event) => set({ departmentId: event.target.value })} />
        <Select label={t('filters.site')} placeholder={t('filters.allFemale')} options={options(sites.data)} value={filters.siteId} onChange={(event) => set({ siteId: event.target.value })} />
      </div>
      {problem !== undefined && <Alert tone="warn">{t(`filters.problems.${problem}`, { max: MAX_REPORT_DAYS })}</Alert>}
    </section>
  );
}
