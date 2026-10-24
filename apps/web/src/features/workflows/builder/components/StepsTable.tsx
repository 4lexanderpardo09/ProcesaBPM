import type { StepDocument, WorkflowVersionDocument } from '@procesabpm/shared';
import { useTranslation } from 'react-i18next';
import { Table } from '@/shared/ui';
import { isPeopleStep } from '../lib/block-catalog';
import { stepBadges } from '../lib/canvas-extras';
import type { ElementProblems } from '../lib/problems';
import styles from './Builder.module.css';

/**
 * The blocks as a table, for whoever prefers to review a flow that way (the help desk's «Lista»): type, name, who takes
 * it and its deadline, where it goes, what it carries and its problems. A row selects the block for the inspector.
 */
export function StepsTable({ doc, selectedId, problemsOf, onSelect }: { readonly doc: WorkflowVersionDocument; readonly selectedId: string | undefined; readonly problemsOf: (id: string) => ElementProblems; readonly onSelect: (id: string) => void }) {
  const { t } = useTranslation('workflows');
  const nameOf = (id: string) => doc.steps.find((step) => step.id === id)?.name ?? '';
  const who = (step: StepDocument) => {
    if (!isPeopleStep(step.type)) return t('builder.node.automatic');
    const mode = t(`builder.assignment.modes.${step.assignmentMode}`);
    return step.slaValue === null || step.slaUnit === null ? mode : `${mode} · ${t('builder.node.sla', { value: step.slaValue, unit: t(`builder.sla.units.${step.slaUnit}`) })}`;
  };
  return (
    <div className={styles.stepsTable}>
      <Table<StepDocument>
        label={t('builder.canvas.list')}
        rows={doc.steps}
        rowKey={(step) => step.id}
        empty={t('builder.canvas.listEmpty')}
        onRowClick={(step) => onSelect(step.id)}
        columns={[
          { key: 'type', header: t('builder.list.type'), width: '130px', cell: (step) => t(`builder.types.${step.type}`) },
          { key: 'name', header: t('builder.list.name'), cell: (step) => (step.id === selectedId ? <strong>{step.name}</strong> : step.name) },
          { key: 'who', header: t('builder.list.who'), cell: who },
          {
            key: 'exits',
            header: t('builder.list.exits'),
            cell: (step) => {
              const exits = doc.transitions.filter((transition) => transition.fromStepId === step.id);
              return exits.length === 0 ? '—' : exits.map((exit) => t('builder.inspector.exitTo', { label: exit.label, to: nameOf(exit.toStepId) })).join(' · ');
            },
          },
          {
            key: 'carries',
            header: t('builder.list.carries'),
            cell: (step) =>
              stepBadges(doc, step)
                .map((badge) => (badge.kind === 'amountRules' || badge.kind === 'files' ? t(`builder.node.badges.${badge.kind}`, { count: badge.count }) : t(`builder.node.badges.${badge.kind}`)))
                .join(' · ') || '—',
          },
          {
            key: 'problems',
            header: t('builder.list.problems'),
            width: '130px',
            cell: (step) => {
              const problems = problemsOf(step.id);
              if (problems.errors.length > 0) return <span className={styles.errorPill}>{t('builder.node.errors', { count: problems.errors.length })}</span>;
              if (problems.warnings.length > 0) return <span className={styles.warningPill}>{t('builder.node.warnings', { count: problems.warnings.length })}</span>;
              return '—';
            },
          },
        ]}
      />
    </div>
  );
}
