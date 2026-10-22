import type { CanvasStyle } from '@procesabpm/shared';
import type { CSSProperties } from 'react';
import { PX_PER_MM, PX_PER_PT } from './canvas-doc';

/** Close screen fonts for the three PDF families, so the sheet looks like the document. */
const FAMILIES: Readonly<Record<CanvasStyle['font'], string>> = {
  HELVETICA: 'Helvetica, Arial, sans-serif',
  TIMES: '"Times New Roman", Times, serif',
  COURIER: '"Courier New", Courier, monospace',
};

const JUSTIFY: Readonly<Record<CanvasStyle['verticalAlign'], CSSProperties['justifyContent']>> = { TOP: 'flex-start', MIDDLE: 'center', BOTTOM: 'flex-end' };

/** How an element's style reads on screen at a zoom: the same sizes as on paper. */
export function cssOf(style: CanvasStyle, zoom: number): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: JUSTIFY[style.verticalAlign],
    boxSizing: 'border-box',
    overflow: 'hidden',
    fontFamily: FAMILIES[style.font],
    fontSize: style.size * PX_PER_PT * zoom,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: style.underline ? 'underline' : 'none',
    color: style.color,
    textAlign: style.align === 'JUSTIFY' ? 'justify' : (style.align.toLowerCase() as CSSProperties['textAlign']),
    lineHeight: style.lineHeight + 0.2,
    background: style.background ?? 'transparent',
    border: style.border > 0 ? `${Math.max(1, style.border * PX_PER_PT * zoom)}px solid ${style.borderColor}` : 'none',
    borderRadius: style.radius * PX_PER_MM * zoom,
    padding: style.padding * PX_PER_MM * zoom,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  };
}
