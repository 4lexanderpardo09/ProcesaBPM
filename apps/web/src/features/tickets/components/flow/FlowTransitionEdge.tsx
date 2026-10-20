import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps, getBezierPath } from '@xyflow/react';
import type { FlowPoint } from '@procesabpm/shared';
import { cx } from '@/shared/lib/cx';
import type { DiagramTransition } from '../../lib/flow-diagram';
import styles from './TicketFlow.module.css';

export type FlowTransitionEdgeType = Edge<{ readonly transition: DiagramTransition }, 'transition'>;

/** A connection: a curve, or straight segments through the builder's bend points; its branch name in a white pill. */
export function FlowTransitionEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data }: EdgeProps<FlowTransitionEdgeType>) {
  const transition = data?.transition;
  const points = transition?.points ?? null;
  const [path, labelX, labelY] =
    points === null || points.length === 0
      ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
      : polylinePath([{ x: sourceX, y: sourceY }, ...points, { x: targetX, y: targetY }]);
  const className = cx(styles.edge, transition !== undefined && styles[`edge-${transition.state}`], transition?.retry === true && styles.retry);
  return (
    <>
      <BaseEdge id={id} path={path} {...(markerEnd === undefined ? {} : { markerEnd })} className={className} />
      {transition !== undefined && transition.label !== '' && (
        <EdgeLabelRenderer>
          <span className={styles.edgeLabel} style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {transition.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

/** Straight segments through every point, with the label on the middle point (or the middle of the only segment). */
function polylinePath(points: readonly FlowPoint[]): [string, number, number] {
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join(' ');
  const middle = points.length % 2 === 1 ? points[(points.length - 1) / 2] : undefined;
  if (middle !== undefined) return [path, middle.x, middle.y];
  const before = points[points.length / 2 - 1] ?? { x: 0, y: 0 };
  const after = points[points.length / 2] ?? before;
  return [path, (before.x + after.x) / 2, (before.y + after.y) / 2];
}
