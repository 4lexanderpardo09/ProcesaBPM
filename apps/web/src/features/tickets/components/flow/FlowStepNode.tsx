import { Handle, type Node, type NodeProps, Position } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import type { DiagramStep } from '../../lib/flow-diagram';
import styles from './TicketFlow.module.css';

export type FlowStepNodeType = Node<{ readonly step: DiagramStep }, 'step'>;

/** A block as the builder draws it: a white card with its type's color stripe, its type, its name and where the ticket stands. */
export function FlowStepNode({ data: { step } }: NodeProps<FlowStepNodeType>) {
  const { t } = useTranslation('tickets');
  return (
    <div className={cx(styles.node, styles[step.state])} data-type={step.type}>
      <Handle type="target" position={Position.Left} isConnectable={false} className={styles.handle} />
      <span className={cx('text-overline', styles.kind)}>{t(`flow.types.${step.type}`)}</span>
      <span className={styles.name}>{step.name}</span>
      <span className={styles.state}>{stateText()}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} className={styles.handle} />
    </div>
  );

  function stateText(): string {
    if (step.state === 'current') return t('flow.state.current');
    if (step.state === 'pending') return t('flow.state.pending');
    return step.passCount > 1 ? t('flow.state.doneTimes', { count: step.passCount }) : t('flow.state.done');
  }
}
