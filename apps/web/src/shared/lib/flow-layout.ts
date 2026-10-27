import dagre from '@dagrejs/dagre';

/** A point on the canvas, in flow coordinates. */
export interface FlowXY {
  readonly x: number;
  readonly y: number;
}

/** A block to place: its id and the size it is drawn at, so blocks never overlap. */
export interface LayoutBlock {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

/** A connection between two blocks; the layout only cares about who leads to whom. */
export interface LayoutLink {
  readonly id: string;
  readonly from: string;
  readonly to: string;
}

/** Space between blocks of the same column, and between columns (room for the connection's name). */
const BLOCK_GAP = 50;
const COLUMN_GAP = 120;

/**
 * Places the blocks left to right in layers, as the help desk does with dagre: each block after the ones leading to it,
 * blocks ordered inside each layer so connections cross as little as possible, loops back left out of the order.
 * Several starts, closing branches and blocks no one reaches all find a place. Answers each block's top-left corner.
 */
export function layeredLayout(blocks: readonly LayoutBlock[], links: readonly LayoutLink[]): Map<string, FlowXY> {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({ rankdir: 'LR', nodesep: BLOCK_GAP, ranksep: COLUMN_GAP, marginx: 20, marginy: 20, ranker: 'network-simplex' });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const block of blocks) graph.setNode(block.id, { width: block.width, height: block.height });
  const known = new Set(blocks.map((block) => block.id));
  for (const link of links) {
    if (link.from !== link.to && known.has(link.from) && known.has(link.to)) graph.setEdge(link.from, link.to, {}, link.id);
  }
  dagre.layout(graph);
  const positions = new Map<string, FlowXY>();
  for (const block of blocks) {
    const placed = graph.node(block.id);
    positions.set(block.id, { x: Math.round(placed.x - block.width / 2), y: Math.round(placed.y - block.height / 2) });
  }
  return positions;
}

/** Space between connections joining the same two blocks, so each one and its name can be seen. */
const PARALLEL_GAP = 30;

/**
 * How far each connection is pushed aside from the straight way: connections joining the same two blocks (in either
 * direction) fan out around it, a lone connection keeps to the middle.
 */
export function parallelOffsets(links: readonly LayoutLink[]): Map<string, number> {
  const groups = new Map<string, LayoutLink[]>();
  for (const link of links) {
    const key = [link.from, link.to].sort().join('\u0000');
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  const offsets = new Map<string, number>();
  for (const group of groups.values()) {
    group.forEach((link, index) => offsets.set(link.id, (index - (group.length - 1) / 2) * PARALLEL_GAP));
  }
  return offsets;
}

/** How far below the lower block a connection going back loops, and how far it leaves and enters its blocks sideways. */
const BACK_DROP = 64;
const BACK_REACH = 48;

/**
 * The path of a connection from a block's right side to another's left side, and where its name goes:
 * - forward, a curve pulled sideways (pushed up or down by its offset when it shares the blocks with others);
 * - back to a block further left, a loop under both blocks, deeper by its offset, so it never crosses them;
 * - back to the same block, an arc above it.
 */
export function connectionPath(source: FlowXY, target: FlowXY, offset = 0, toItself = false): [string, number, number] {
  if (toItself) {
    const top = Math.min(source.y, target.y) - 70 + Math.min(offset, 0);
    return [`M${source.x},${source.y} C${source.x + 70},${top} ${target.x - 70},${top} ${target.x},${target.y}`, (source.x + target.x) / 2, top + 18];
  }
  if (target.x < source.x + 20) {
    const bottom = Math.max(source.y, target.y) + BACK_DROP + Math.abs(offset);
    const middle = (source.x + target.x) / 2;
    const out = source.x + BACK_REACH;
    const back = target.x - BACK_REACH;
    return [`M${source.x},${source.y} C${out},${source.y} ${out},${bottom} ${middle},${bottom} C${back},${bottom} ${back},${target.y} ${target.x},${target.y}`, middle, bottom];
  }
  const pull = Math.max((target.x - source.x) / 2, 60);
  const c1 = { x: source.x + pull, y: source.y + offset * 1.6 };
  const c2 = { x: target.x - pull, y: target.y + offset * 1.6 };
  // The label sits on the curve's middle (t = 0.5 of the cubic).
  const labelX = (source.x + 3 * c1.x + 3 * c2.x + target.x) / 8;
  const labelY = (source.y + 3 * c1.y + 3 * c2.y + target.y) / 8;
  return [`M${source.x},${source.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${target.x},${target.y}`, labelX, labelY];
}
