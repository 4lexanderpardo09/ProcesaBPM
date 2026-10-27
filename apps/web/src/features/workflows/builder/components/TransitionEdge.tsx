import type { TransitionDocument } from '@procesabpm/shared';
import { BaseEdge, type Edge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';
import { cx } from '@/shared/lib/cx';
import { connectionPath } from '@/shared/lib/flow-layout';
import styles from './Builder.module.css';

export interface TransitionEdgeData extends Record<string, unknown> {
  readonly transition: TransitionDocument;
  /** Effects and system-only ways out are drawn dashed. */
  readonly dashed: boolean;
  readonly errors: number;
  /** How far it is pushed aside from the other connections joining the same two blocks. */
  readonly offset: number;
  /** The label is a button: a click on it selects the connection, like a click on the curve. */
  readonly onSelect: (transitionId: string) => void;
}

export type TransitionEdgeType = Edge<TransitionEdgeData, 'transition'>;

/**
 * A 2px curve with the way out's name in a white pill; accent when selected, red when it has errors. Connections
 * sharing two blocks fan out, and one going back loops under the blocks instead of crossing them.
 */
export function TransitionEdge({ id, source, target, sourceX, sourceY, targetX, targetY, data, selected, markerEnd }: EdgeProps<TransitionEdgeType>) {
  const [path, labelX, labelY] = connectionPath({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, data?.offset ?? 0, source === target);
  const errors = data?.errors ?? 0;
  const color = selected === true ? 'var(--accent)' : errors > 0 ? 'var(--danger)' : 'var(--faint)';
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        style={{ stroke: color, strokeWidth: 2, ...(data?.dashed === true ? { strokeDasharray: '6 5' } : {}) }}
        interactionWidth={18}
      />
      {data !== undefined && (
        <EdgeLabelRenderer>
          <span
            className={cx('nodrag', 'nopan', styles.edgeLabel, selected === true && styles.edgeLabelSelected, errors > 0 && styles.edgeLabelError)}
            style={{ transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)` }}
            onClick={() => data.onSelect(data.transition.id)}
          >
            {data.transition.label}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
