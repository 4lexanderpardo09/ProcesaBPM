import '@xyflow/react/dist/style.css';
import type { StepType, WorkflowVersionDocument } from '@procesabpm/shared';
import {
  applyNodeChanges,
  Background,
  Controls,
  type EdgeChange,
  MiniMap,
  MarkerType,
  type NodeChange,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react';
import { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EFFECT_TYPES } from '../lib/block-catalog';
import { moveStep, removeStep, removeTransition, type Selection } from '../lib/builder-doc';
import { peopleOf, stepBadges } from '../lib/canvas-extras';
import type { ElementProblems } from '../lib/problems';
import { BlockNode, type BlockNodeType } from './BlockNode';
import { TransitionEdge, type TransitionEdgeType } from './TransitionEdge';
import styles from './Builder.module.css';

export const BLOCK_DRAG_TYPE = 'application/x-procesabpm-block';

const nodeTypes = { block: BlockNode };
const edgeTypes = { transition: TransitionEdge };
const NODE_WIDTH = 180;
const NODE_HEIGHT = 64;

export interface BuilderCanvasProps {
  readonly doc: WorkflowVersionDocument;
  readonly selection: Selection;
  readonly readOnly: boolean;
  readonly problemsOf: (id: string) => ElementProblems;
  readonly onSelect: (selection: Selection) => void;
  readonly onChange: (next: (doc: WorkflowVersionDocument) => WorkflowVersionDocument) => void;
  readonly onConnect: (fromId: string, toId: string) => void;
  readonly onDropBlock: (type: StepType, position: { x: number; y: number }) => void;
  /** The small map of the whole flow, in a corner (big flows). */
  readonly showMiniMap?: boolean;
  /** Names of the people and records the blocks name (creators, candidates). */
  readonly nameOf?: (id: string) => string | undefined;
}

const noNames = (): string | undefined => undefined;

function toNodes(doc: WorkflowVersionDocument, selection: Selection, readOnly: boolean, problemsOf: (id: string) => ElementProblems, nameOf: (id: string) => string | undefined): BlockNodeType[] {
  return doc.steps.map((step) => {
    const problems = problemsOf(step.id);
    return {
      id: step.id,
      type: 'block',
      position: { x: step.ui.x, y: step.ui.y },
      selected: selection?.kind === 'step' && selection.id === step.id,
      draggable: !readOnly,
      deletable: !readOnly,
      ariaLabel: `${step.type}: ${step.name}`,
      data: { step, errors: problems.errors.length, warnings: problems.warnings.length, readOnly, badges: stepBadges(doc, step), people: peopleOf(step, nameOf) },
    };
  });
}

/**
 * The canvas: blocks where the person left them, connections with their names, problems marked on each. Moving a block
 * is saved in the document when the drag ends; selection lives in the page (the inspector shows it).
 */
export function BuilderCanvas({ doc, selection, readOnly, problemsOf, onSelect, onChange, onConnect, onDropBlock, showMiniMap = false, nameOf = noNames }: BuilderCanvasProps) {
  const { t } = useTranslation('workflows');
  const { screenToFlowPosition } = useReactFlow();
  const [nodes, setNodes] = useState(() => toNodes(doc, selection, readOnly, problemsOf, nameOf));
  useEffect(() => setNodes(toNodes(doc, selection, readOnly, problemsOf, nameOf)), [doc, selection, readOnly, problemsOf, nameOf]);

  const stepType = useMemo(() => new Map(doc.steps.map((step) => [step.id, step.type])), [doc.steps]);
  const edges = useMemo<TransitionEdgeType[]>(
    () =>
      doc.transitions.map((transition) => {
        const from = stepType.get(transition.fromStepId);
        const selected = selection?.kind === 'transition' && selection.id === transition.id;
        return {
          id: transition.id,
          type: 'transition',
          source: transition.fromStepId,
          target: transition.toStepId,
          selected,
          deletable: !readOnly,
          ariaLabel: transition.label,
          markerEnd: { type: MarkerType.ArrowClosed, color: selected ? 'var(--accent)' : 'var(--faint)', width: 16, height: 16 },
          data: {
            transition,
            dashed: transition.type === 'SYSTEM_ONLY' || (from !== undefined && EFFECT_TYPES.has(from)),
            errors: problemsOf(transition.id).errors.length,
            onSelect: (id: string) => onSelect({ kind: 'transition', id }),
          },
        };
      }),
    [doc.transitions, stepType, selection, readOnly, problemsOf, onSelect],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange<BlockNodeType>[]) => {
      for (const change of changes) if (change.type === 'select' && change.selected) onSelect({ kind: 'step', id: change.id });
      setNodes((current) => applyNodeChanges(changes.filter((change) => change.type === 'position' || change.type === 'dimensions'), current));
    },
    [onSelect],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange<TransitionEdgeType>[]) => {
      for (const change of changes) if (change.type === 'select' && change.selected) onSelect({ kind: 'transition', id: change.id });
    },
    [onSelect],
  );

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const type = event.dataTransfer.getData(BLOCK_DRAG_TYPE) as StepType | '';
    if (type === '' || readOnly) return;
    event.preventDefault();
    const point = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    onDropBlock(type, { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 });
  };

  const ariaLabelConfig = useMemo(
    () => ({
      'controls.ariaLabel': t('builder.canvas.controls'),
      'controls.zoomIn.ariaLabel': t('builder.canvas.zoomIn'),
      'controls.zoomOut.ariaLabel': t('builder.canvas.zoomOut'),
      'controls.fitView.ariaLabel': t('builder.canvas.fitView'),
    }),
    [t],
  );

  return (
    <div
      className={styles.canvas}
      role="region"
      aria-label={t('builder.canvas.label')}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes(BLOCK_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={onDrop}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        ariaLabelConfig={ariaLabelConfig}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_event, _node, dragged) => onChange((current) => dragged.reduce((next, node) => moveStep(next, node.id, node.position), current))}
        onNodesDelete={(deleted) => onChange((current) => deleted.reduce((next, node) => removeStep(next, node.id), current))}
        onEdgesDelete={(deleted) => onChange((current) => deleted.reduce((next, edge) => removeTransition(next, edge.id), current))}
        onConnect={({ source, target }) => onConnect(source, target)}
        onPaneClick={() => onSelect(null)}
        nodesConnectable={!readOnly}
        nodesDraggable={!readOnly}
        deleteKeyCode={readOnly ? null : ['Delete', 'Backspace']}
        multiSelectionKeyCode={null}
        selectionKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.12 }}
        minZoom={0.25}
        maxZoom={1.75}
        snapToGrid
        snapGrid={[8, 8]}
      >
        <Background gap={16} size={1} color="var(--line)" />
        <Controls showInteractive={false} />
        {showMiniMap && <MiniMap pannable zoomable ariaLabel={t('builder.canvas.miniMap')} nodeColor="var(--line)" />}
      </ReactFlow>
    </div>
  );
}
