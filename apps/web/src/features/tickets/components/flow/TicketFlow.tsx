import '@xyflow/react/dist/style.css';
import type { TicketFlowResponse } from '@procesabpm/shared';
import type { UseQueryResult } from '@tanstack/react-query';
import { Background, Controls, type Edge, MarkerType, type Node, ReactFlow } from '@xyflow/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/shared/ui';
import { type FlowDiagram, type FlowTransitionState, flowDiagram } from '../../lib/flow-diagram';
import { LoadError } from '../LoadError';
import { FlowStepNode, type FlowStepNodeType } from './FlowStepNode';
import { FlowTransitionEdge, type FlowTransitionEdgeType } from './FlowTransitionEdge';
import styles from './TicketFlow.module.css';

const nodeTypes = { step: FlowStepNode };
/** Never larger than the builder draws it: a short flow stays at its real size instead of filling the card. */
const fitViewOptions = { maxZoom: 1, padding: 0.15 };
const edgeTypes = { transition: FlowTransitionEdge };

const EDGE_COLOR: Readonly<Record<FlowTransitionState, string>> = { taken: 'var(--ok)', next: 'var(--accent)', pending: 'var(--faint)' };

export interface TicketFlowProps {
  readonly flow: UseQueryResult<TicketFlowResponse>;
}

/** "Avance del flujo": the graph of the ticket's workflow version with what it went through, where it is and what is left. */
export function TicketFlow({ flow }: TicketFlowProps) {
  const { t } = useTranslation('tickets');
  return (
    <Card title={t('flow.title')} actions={<Legend />}>
      {flow.isError ? (
        <LoadError error={flow.error} onRetry={() => void flow.refetch()} />
      ) : flow.data === undefined ? (
        <p className={styles.muted}>{t('flow.loading')}</p>
      ) : (
        <FlowCanvas flow={flow.data} />
      )}
    </Card>
  );
}

function FlowCanvas({ flow }: { readonly flow: TicketFlowResponse }) {
  const { t } = useTranslation('tickets');
  const diagram = useMemo(() => flowDiagram(flow), [flow]);
  const { nodes, edges } = useMemo(() => toReactFlow(diagram), [diagram]);
  const ariaLabelConfig = useMemo(
    () => ({
      'controls.ariaLabel': t('flow.controls.label'),
      'controls.zoomIn.ariaLabel': t('flow.controls.zoomIn'),
      'controls.zoomOut.ariaLabel': t('flow.controls.zoomOut'),
      'controls.fitView.ariaLabel': t('flow.controls.fitView'),
    }),
    [t],
  );
  return (
    <>
      <div className={styles.canvas}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          ariaLabelConfig={ariaLabelConfig}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={0.3}
          maxZoom={1.5}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          zoomOnScroll={false}
          preventScrolling={false}
        >
          <Background gap={16} size={1} color="var(--line)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <ol className={styles.visuallyHidden} aria-label={t('flow.stepsLabel')}>
        {diagram.steps.map((step) => (
          <li key={step.id}>
            {t(`flow.types.${step.type}`)} {step.name}: {t(`flow.state.${step.state}`)}
          </li>
        ))}
      </ol>
    </>
  );
}

function toReactFlow(diagram: FlowDiagram): { nodes: Node[]; edges: Edge[] } {
  const nodes: FlowStepNodeType[] = diagram.steps.map((step) => ({ id: step.id, type: 'step', position: step.position, data: { step } }));
  const edges: FlowTransitionEdgeType[] = diagram.transitions.map((transition) => ({
    id: transition.id,
    type: 'transition',
    source: transition.source,
    target: transition.target,
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLOR[transition.state], width: 16, height: 16 },
    data: { transition },
  }));
  return { nodes, edges };
}

function Legend() {
  const { t } = useTranslation('tickets');
  return (
    <ul className={styles.legend} aria-label={t('flow.legend.label')}>
      <li className={styles.legendDone}>{t('flow.legend.done')}</li>
      <li className={styles.legendCurrent}>{t('flow.legend.current')}</li>
      <li className={styles.legendPending}>{t('flow.legend.pending')}</li>
    </ul>
  );
}
