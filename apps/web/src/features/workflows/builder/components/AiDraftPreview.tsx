import type { AiDraftPreview as Preview } from '@procesabpm/shared';
import { type Edge, MarkerType, type Node, ReactFlow, ReactFlowProvider } from '@xyflow/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cx } from '@/shared/lib/cx';
import { layeredLayout } from '@/shared/lib/flow-layout';
import styles from './Builder.module.css';

const NODE_WIDTH = 150;
const NODE_HEIGHT = 44;
const fitViewOptions = { maxZoom: 0.9, padding: 0.1 };

/**
 * The diagram the AI has written so far, drawn while it writes it: read-only, laid out like «Ordenar», growing as the
 * blocks arrive. Its own React Flow (the builder's canvas has another), with the blocks also listed for screen readers.
 */
export function AiDraftPreview({ preview }: { readonly preview: Preview }) {
  const { t } = useTranslation('workflows');
  const { nodes, edges } = useMemo(() => {
    const positions = layeredLayout(
      preview.steps.map((step) => ({ id: step.ref, width: NODE_WIDTH, height: NODE_HEIGHT })),
      preview.transitions.map((transition, index) => ({ id: String(index), from: transition.from, to: transition.to })),
    );
    const nodes: Node[] = preview.steps.map((step) => ({
      id: step.ref,
      position: positions.get(step.ref) ?? { x: 0, y: 0 },
      data: { label: step.name },
      className: cx(styles.aiPreviewNode, styles[`aiPreview_${step.type}`]),
      style: { width: NODE_WIDTH },
      draggable: false,
      connectable: false,
      ariaLabel: `${t(`builder.types.${step.type}`)} ${step.name}`,
    }));
    const edges: Edge[] = preview.transitions.map((transition, index) => ({
      id: String(index),
      source: transition.from,
      target: transition.to,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));
    return { nodes, edges };
  }, [preview, t]);

  return (
    <figure className={styles.aiPreview}>
      <figcaption className={styles.aiMeta}>{t('builder.ai.preview.caption', { count: preview.steps.length })}</figcaption>
      <div className={styles.aiPreviewCanvas} aria-hidden="true">
        <ReactFlowProvider>
          {/* `key`: fit again whenever a block arrives. */}
          <ReactFlow
            key={preview.steps.length}
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={fitViewOptions}
            minZoom={0.2}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable={false}
            edgesFocusable={false}
            elementsSelectable={false}
            panOnDrag={false}
            zoomOnScroll={false}
            zoomOnPinch={false}
            zoomOnDoubleClick={false}
            preventScrolling={false}
          />
        </ReactFlowProvider>
      </div>
      <ol className={styles.visuallyHidden} aria-label={t('builder.ai.preview.listLabel')}>
        {preview.steps.map((step) => (
          <li key={step.ref}>
            {t(`builder.types.${step.type}`)}: {step.name}
          </li>
        ))}
      </ol>
    </figure>
  );
}
