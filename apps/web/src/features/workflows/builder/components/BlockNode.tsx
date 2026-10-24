import type { StepDocument } from '@procesabpm/shared';
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { isPeopleStep, NOT_AVAILABLE_TYPES } from '../lib/block-catalog';
import type { PeopleGroup, StepBadge } from '../lib/canvas-extras';
import styles from './Builder.module.css';

export interface BlockNodeData extends Record<string, unknown> {
  readonly step: StepDocument;
  readonly errors: number;
  readonly warnings: number;
  readonly readOnly: boolean;
  /** Amount caps, cutoff, export, batch and support files of the block. */
  readonly badges: readonly StepBadge[];
  /** The start's creators or a step's candidates, by kind, with their names. */
  readonly people: readonly PeopleGroup[];
}

/** How many names a kind shows on the card before «+N». */
const SHOWN_NAMES = 3;

export type BlockNodeType = Node<BlockNodeData, 'block'>;

/** A block: white card with its type's stripe, the type, the name, one line of what it does and its problems. */
export function BlockNode({ data: { step, errors, warnings, readOnly, badges, people }, selected }: NodeProps<BlockNodeType>) {
  const { t } = useTranslation('workflows');
  return (
    <div className={cx(styles.node, selected && styles.nodeSelected, errors > 0 && styles.nodeError)} data-type={step.type}>
      {step.type !== 'START' && <Handle type="target" position={Position.Left} isConnectable={!readOnly} className={styles.handle} />}
      <span className={cx('text-overline', styles.kind)}>{t(`builder.types.${step.type}`)}</span>
      <span className={styles.nodeName}>{step.name}</span>
      <span className={styles.nodeState}>{summary()}</span>
      {step.type === 'START' && people.length === 0 && <span className={styles.nodePeopleEmpty}>{t('builder.node.anyCreator')}</span>}
      {people.length > 0 && (
        <span className={styles.nodePeople}>
          {step.type === 'START' && <span className={styles.nodePeopleTitle}>{t('builder.node.creators')}</span>}
          {people.map((group) => (
            <span key={group.kind} className={styles.nodePeopleRow} title={group.names.join(', ')}>
              <span className={styles.nodePeopleKind}>{t(`builder.node.kinds.${group.kind}`)}</span>
              {group.names.slice(0, SHOWN_NAMES).map((name) => (
                <span key={name} className={styles.nodeChip}>
                  {name}
                </span>
              ))}
              {group.names.length > SHOWN_NAMES && <span className={styles.nodeMore}>+{group.names.length - SHOWN_NAMES}</span>}
            </span>
          ))}
        </span>
      )}
      {badges.length > 0 && (
        <span className={styles.nodeBadges}>
          {badges.map((badge) => (
            <span key={badge.kind} className={cx(styles.nodeBadge, badge.kind === 'amountRules' && styles[`cap${badge.strongest}`])} title={t(`builder.node.badgeHints.${badge.kind}`)}>
              {badge.kind === 'amountRules' || badge.kind === 'files' ? t(`builder.node.badges.${badge.kind}`, { count: badge.count }) : t(`builder.node.badges.${badge.kind}`)}
            </span>
          ))}
        </span>
      )}
      {(errors > 0 || warnings > 0) && (
        <span className={styles.nodeProblems}>
          {errors > 0 && <span className={styles.errorPill}>{t('builder.node.errors', { count: errors })}</span>}
          {warnings > 0 && <span className={styles.warningPill}>{t('builder.node.warnings', { count: warnings })}</span>}
        </span>
      )}
      {step.type !== 'END' && <Handle type="source" position={Position.Right} isConnectable={!readOnly} className={styles.handle} />}
    </div>
  );

  function summary(): string {
    if (NOT_AVAILABLE_TYPES.has(step.type)) return t('builder.node.notAvailable');
    if (step.type === 'START') return t('builder.node.opens');
    if (step.type === 'END') return t('builder.node.closes');
    if (!isPeopleStep(step.type)) return t('builder.node.automatic');
    const mode = t(`builder.assignment.modes.${step.assignmentMode}`);
    return step.slaValue === null || step.slaUnit === null ? mode : `${mode} · ${t('builder.node.sla', { value: step.slaValue, unit: t(`builder.sla.units.${step.slaUnit}`) })}`;
  }
}
