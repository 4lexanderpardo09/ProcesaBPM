import { describe, expect, it } from 'vitest';
import { connectionPath, layeredLayout, parallelOffsets } from './flow-layout';

const block = (id: string) => ({ id, width: 180, height: 80 });
const link = (from: string, to: string, id = `${from}-${to}`) => ({ id, from, to });

describe('layeredLayout', () => {
  it('places each block right of the ones leading to it, loops included, and never two blocks on top of each other', () => {
    const blocks = ['start', 'boss', 'payroll', 'end', 'lost'].map(block);
    const positions = layeredLayout(blocks, [link('start', 'boss'), link('boss', 'payroll'), link('payroll', 'boss'), link('boss', 'end'), link('payroll', 'end')]);
    const x = (id: string) => positions.get(id)?.x ?? Number.NaN;
    expect(x('start')).toBeLessThan(x('boss'));
    expect(x('boss')).toBeLessThan(x('payroll'));
    expect(x('payroll')).toBeLessThan(x('end'));
    expect(positions.has('lost')).toBe(true);
    const boxes = [...positions.values()];
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(Math.abs(a.x - b.x) >= 180 || Math.abs(a.y - b.y) >= 80).toBe(true);
    }
  });

  it('keeps blocks reached from several starts in one flow, without stacking the starts on each other', () => {
    const blocks = ['s1', 's2', 's3', 'shared', 'end'].map(block);
    const positions = layeredLayout(blocks, [link('s1', 'shared'), link('s2', 'shared'), link('s3', 'end'), link('shared', 'end')]);
    const starts = ['s1', 's2', 's3'].map((id) => positions.get(id)?.y);
    expect(new Set(starts).size).toBe(3);
    expect(positions.get('shared')?.x).toBeGreaterThan(positions.get('s1')?.x ?? 0);
  });

  it('ignores a connection of a block to itself and connections to blocks that are not there', () => {
    const positions = layeredLayout([block('a')], [link('a', 'a'), link('a', 'ghost')]);
    expect([...positions.keys()]).toEqual(['a']);
  });
});

describe('parallelOffsets', () => {
  it('fans out the connections joining the same two blocks, either way, and leaves a lone one in the middle', () => {
    const offsets = parallelOffsets([link('a', 'b', 'approve'), link('a', 'b', 'reject'), link('b', 'a', 'back'), link('b', 'c', 'alone')]);
    expect(offsets.get('approve')).toBe(-30);
    expect(offsets.get('reject')).toBe(0);
    expect(offsets.get('back')).toBe(30);
    expect(offsets.get('alone')).toBe(0);
  });
});

describe('connectionPath', () => {
  it('draws a forward connection as one curve, with its name on the middle and pushed by its offset', () => {
    const [path, labelX, labelY] = connectionPath({ x: 0, y: 0 }, { x: 200, y: 0 }, 30);
    expect(path.startsWith('M0,0 C')).toBe(true);
    expect(labelX).toBe(100);
    expect(labelY).toBeCloseTo(36);
  });

  it('loops a connection going back under both blocks, deeper when it shares them with another', () => {
    const [, , lone] = connectionPath({ x: 400, y: 100 }, { x: 0, y: 40 });
    const [, , shared] = connectionPath({ x: 400, y: 100 }, { x: 0, y: 40 }, 30);
    expect(lone).toBe(164);
    expect(shared).toBe(194);
  });

  it('arcs a connection back to its own block above it', () => {
    const [path, , labelY] = connectionPath({ x: 180, y: 40 }, { x: 0, y: 40 }, 0, true);
    expect(path).toContain('C250,-30');
    expect(labelY).toBe(-12);
  });
});
