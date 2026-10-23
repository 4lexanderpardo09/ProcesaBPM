import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { paths } from '@/shared/lib/paths';
import { usePermissions } from '@/shared/session';
import { PageHeader, Tabs } from '@/shared/ui';
import { ReportFiltersBar } from '../components/ReportFiltersBar';
import styles from '../components/Reports.module.css';
import { BacklogTab } from '../components/tabs/BacklogTab';
import { CategoriesTab } from '../components/tabs/CategoriesTab';
import { DistributionTab } from '../components/tabs/DistributionTab';
import { DownloadsTab } from '../components/tabs/DownloadsTab';
import { HeatmapTab } from '../components/tabs/HeatmapTab';
import { IncidentsTab } from '../components/tabs/IncidentsTab';
import { PeopleTab } from '../components/tabs/PeopleTab';
import { RankingTab } from '../components/tabs/RankingTab';
import { SitesTab } from '../components/tabs/SitesTab';
import { StepsTab } from '../components/tabs/StepsTab';
import { SummaryTab } from '../components/tabs/SummaryTab';
import { periodProblem, readFilters, type ReportFilters, writeFilters } from '../lib/report-filters';

const TABS = ['summary', 'ranking', 'sites', 'heatmap', 'categories', 'steps', 'distribution', 'incidents', 'backlog', 'people', 'downloads'] as const;
type ReportTab = (typeof TABS)[number];

/** The backlog is a snapshot of now: a period it does not use never hides it. */
const NEEDS_PERIOD: ReadonlySet<ReportTab> = new Set(TABS.filter((tab) => tab !== 'backlog'));

/** The level sites are grouped by, from the address (1, the top of the tree, when it has none). */
function readLevel(params: URLSearchParams): number {
  const level = Number(params.get('level'));
  return Number.isInteger(level) && level >= 1 ? level : 1;
}

/** The help desk's reports, a tab per report (`/reports/sites`); the filters live in the address, so a view can be shared as a link. */
export function ReportsPage() {
  const { t } = useTranslation('reports');
  const { can, loaded } = usePermissions();
  const { tab } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  if (!loaded) return <p className={styles.note}>{t('loading')}</p>;
  if (!can('read', 'Report')) return <Navigate to={paths.home} replace />;
  const current: ReportTab = TABS.find((candidate) => candidate === tab) ?? 'summary';
  const filters = readFilters(params);
  const level = readLevel(params);
  const setFilters = (next: ReportFilters) => setParams(writeFilters(params, next), { replace: true });
  const setLevel = (next: number) => {
    const updated = new URLSearchParams(params);
    updated.set('level', String(next));
    setParams(updated, { replace: true });
  };
  const blocked = NEEDS_PERIOD.has(current) && periodProblem(filters.from, filters.to) !== undefined;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <ReportFiltersBar filters={filters} onChange={setFilters} />
      <div className={styles.tabs}>
        <Tabs
          label={t('tabsLabel')}
          items={TABS.map((value) => ({ value, label: t(`tabs.${value}`) }))}
          value={current}
          onChange={(next) => void navigate({ pathname: `${paths.reports}/${next}`, search: params.toString() }, { replace: true })}
        />
      </div>
      {!blocked && (
        <>
          {current === 'summary' && <SummaryTab filters={filters} />}
          {current === 'ranking' && <RankingTab filters={filters} />}
          {current === 'sites' && <SitesTab filters={filters} level={level} onLevel={setLevel} />}
          {current === 'heatmap' && <HeatmapTab filters={filters} level={level} onLevel={setLevel} />}
          {current === 'categories' && <CategoriesTab filters={filters} />}
          {current === 'steps' && <StepsTab filters={filters} />}
          {current === 'distribution' && <DistributionTab filters={filters} />}
          {current === 'incidents' && <IncidentsTab filters={filters} />}
          {current === 'backlog' && <BacklogTab filters={filters} />}
          {current === 'people' && <PeopleTab filters={filters} />}
          {current === 'downloads' && <DownloadsTab filters={filters} />}
        </>
      )}
    </>
  );
}
