import type { FlowEdgeSpec } from '../data/flows';

interface Box {
  readonly l: number;
  readonly r: number;
  readonly t: number;
  readonly b: number;
  readonly cx: number;
  readonly cy: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function boxOf(canvas: HTMLElement, origin: DOMRect, id: string): Box {
  const node = canvas.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
  if (node === null) throw new Error(`No node ${id} in #${canvas.id}`);
  const e = node.getBoundingClientRect();
  return { l: e.left - origin.left, r: e.right - origin.left, t: e.top - origin.top, b: e.bottom - origin.top, cx: e.left - origin.left + e.width / 2, cy: e.top - origin.top + e.height / 2 };
}

/** The path between two nodes and the point where its label sits: straight when aligned, a curve otherwise, a dip below for a return. */
function route(a: Box, c: Box, edge: FlowEdgeSpec, height: number): { d: string; mid: readonly [number, number] } {
  if (edge.kind === 'retry') {
    const dip = Math.max(a.b, c.b) + height * 0.07;
    return { d: `M${a.cx} ${a.b} C${a.cx} ${dip} ${c.cx} ${dip} ${c.cx} ${c.b}`, mid: [(a.cx + c.cx) / 2, dip - (dip - Math.max(a.b, c.b)) * 0.25] };
  }
  if (Math.abs(a.cy - c.cy) < 4) {
    const x1 = a.cx < c.cx ? a.r : a.l;
    const x2 = a.cx < c.cx ? c.l : c.r;
    return { d: `M${x1} ${a.cy} L${x2} ${c.cy}`, mid: [(x1 + x2) / 2, a.cy] };
  }
  if (Math.abs(a.cx - c.cx) < 4) {
    const y1 = a.cy < c.cy ? a.b : a.t;
    const y2 = a.cy < c.cy ? c.t : c.b;
    return { d: `M${a.cx} ${y1} L${c.cx} ${y2}`, mid: [a.cx, (y1 + y2) / 2] };
  }
  const down = a.cy < c.cy;
  const sx = a.l + (a.r - a.l) * (a.cx < c.cx ? 0.75 : 0.25);
  const sy = down ? a.b : a.t;
  const ey = down ? c.t : c.b;
  const my = (sy + ey) / 2;
  return { d: `M${sx} ${sy} C${sx} ${my} ${c.cx} ${my} ${c.cx} ${ey}`, mid: [(sx + c.cx) / 2, my] };
}

/** Draws the connections of a FlowCanvas from its nodes' boxes; call it again after a resize. */
export function drawEdges(canvas: HTMLElement): void {
  const edges = JSON.parse(canvas.dataset['edges'] ?? '[]') as FlowEdgeSpec[];
  const svg = canvas.querySelector('svg.edges');
  if (svg === null) return;
  const origin = canvas.getBoundingClientRect();
  svg.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
  svg.replaceChildren();
  for (const edge of edges) {
    const { d, mid } = route(boxOf(canvas, origin, edge.from), boxOf(canvas, origin, edge.to), edge, origin.height);
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.dataset['edge'] = `${edge.from}-${edge.to}`;
    if (edge.kind !== undefined) path.classList.add(edge.kind);
    svg.append(path);
    const label = canvas.querySelector<HTMLElement>(`.edge-label[data-for="${edge.from}-${edge.to}"]`);
    if (label !== null) {
      label.style.left = `${mid[0]}px`;
      label.style.top = `${mid[1]}px`;
    }
  }
}

/** Redraws on resize and once the web fonts arrive (they change the nodes' size). */
export function keepEdgesDrawn(canvas: HTMLElement, after: () => void = () => undefined): void {
  const redraw = () => {
    drawEdges(canvas);
    after();
  };
  redraw();
  new ResizeObserver(redraw).observe(canvas);
  void document.fonts.ready.then(redraw);
}
