import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './FlowIllustration.module.css';

type NodeKey = 'start' | 'step' | 'approval' | 'decision' | 'end';

interface FlowNode {
  readonly key: NodeKey;
  readonly x: number;
  readonly y: number;
}

const NODE_WIDTH = 150;
const NODE_HEIGHT = 46;
const STRIPE_WIDTH = 4;

const nodes: readonly FlowNode[] = [
  { key: 'start', x: 20, y: 16 },
  { key: 'step', x: 20, y: 104 },
  { key: 'approval', x: 190, y: 104 },
  { key: 'decision', x: 190, y: 192 },
  { key: 'end', x: 190, y: 270 },
];

/** A small sample workflow drawn like the builder's nodes; decorative, so screen readers skip it. */
export function FlowIllustration() {
  const { t } = useTranslation('auth');
  const id = useId();
  const arrow = `${id}-arrow`;
  const retryArrow = `${id}-retry-arrow`;
  return (
    <svg viewBox="0 0 360 324" className={styles.illustration} aria-hidden="true" focusable="false">
      <defs>
        <marker id={arrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 8 4 0 8z" className={styles.arrowHead} />
        </marker>
        <marker id={retryArrow} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0 0 8 4 0 8z" className={styles.retryArrowHead} />
        </marker>
        {nodes.map((node) => (
          <clipPath key={node.key} id={`${id}-${node.key}`}>
            <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} rx="8" />
          </clipPath>
        ))}
      </defs>
      <path d="M95 62V102" className={styles.edge} markerEnd={`url(#${arrow})`} />
      <path d="M170 127H188" className={styles.edge} markerEnd={`url(#${arrow})`} />
      <path d="M265 150V190" className={styles.edge} markerEnd={`url(#${arrow})`} />
      <path d="M265 238V268" className={styles.edge} markerEnd={`url(#${arrow})`} />
      <path d="M190 215H111Q95 215 95 199V152" className={styles.retryEdge} markerEnd={`url(#${retryArrow})`} />
      <BranchLabel x={265} y={253} text={t('brand.flow.yes')} />
      <BranchLabel x={142} y={215} text={t('brand.flow.no')} />
      {nodes.map((node) => (
        <g key={node.key} clipPath={`url(#${id}-${node.key})`}>
          <rect x={node.x} y={node.y} width={NODE_WIDTH} height={NODE_HEIGHT} className={styles.node} />
          <rect x={node.x} y={node.y} width={STRIPE_WIDTH} height={NODE_HEIGHT} className={styles[node.key]} />
          <text x={node.x + 14} y={node.y + 19} className={`${styles.kind} ${styles[node.key]}`}>
            {t(`brand.flow.${node.key}.kind`).toLocaleUpperCase('es')}
          </text>
          <text x={node.x + 14} y={node.y + 35} className={styles.name}>
            {t(`brand.flow.${node.key}.name`)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function BranchLabel({ x, y, text }: { readonly x: number; readonly y: number; readonly text: string }) {
  return (
    <g>
      <rect x={x - 14} y={y - 9} width="28" height="18" rx="9" className={styles.branch} />
      <text x={x} y={y + 4} textAnchor="middle" className={styles.branchText}>
        {text}
      </text>
    </g>
  );
}
