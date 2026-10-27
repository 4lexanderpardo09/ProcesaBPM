import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { cx } from '@/shared/lib/cx';
import { connectionPath } from '@/shared/lib/flow-layout';
import type { DiagramTransition } from '../../lib/flow-diagram';
import styles from './TicketFlow.module.css';

export type FlowTransitionEdgeType = Edge<{ readonly transition: DiagramTransition; readonly dimmed: boolean }, 'transition'>;

/**
 * A connection: a curve forward, fanned out from the others joining the same blocks, or a loop under the blocks for a
 * retry; its branch name in a white pill. Faded when the person asked to see only the ticket's way.
 */
export function FlowTransitionEdge({ id, source, target, sourceX, sourceY, targetX, targetY, markerEnd, data }: EdgeProps<FlowTransitionEdgeType>) {
  const transition = data?.transition;
  const [path, labelX, labelY] = connectionPath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, transition?.offset ?? 0, source === target);
  const className = cx(styles.edge, transition !== undefined && styles[`edge-${transition.state}`], transition?.retry === true && styles.retry, data?.dimmed === true && styles.dimmed);
  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd === undefined ? {} : { markerEnd })} className={className} />
      {transition !== undefined && transition.label !== '' && (
        <EdgeLabelRenderer>
          <span className={cx(styles.edgeLabel, data?.dimmed === true && styles.dimmed)} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {transition.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
