import { type StepType } from './constants.js';

export interface GraphNode {
  readonly id: string;
  readonly type: StepType;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/** Adjacency of a workflow: every transition counts (SYSTEM_ONLY included), edges to unknown blocks are ignored. */
export class WorkflowGraph {
  private readonly out = new Map<string, string[]>();
  private readonly inn = new Map<string, string[]>();
  private readonly withoutCache = new Map<string, Set<string>>();

  constructor(
    readonly nodes: readonly GraphNode[],
    edges: readonly GraphEdge[],
  ) {
    for (const node of nodes) {
      this.out.set(node.id, []);
      this.inn.set(node.id, []);
    }
    for (const edge of edges) {
      if (!this.out.has(edge.from) || !this.out.has(edge.to)) continue;
      this.out.get(edge.from)!.push(edge.to);
      this.inn.get(edge.to)!.push(edge.from);
    }
  }

  get starts(): string[] {
    return this.nodes.filter((node) => node.type === 'START').map((node) => node.id);
  }

  get ends(): string[] {
    return this.nodes.filter((node) => node.type === 'END').map((node) => node.id);
  }

  exitsOf(id: string): readonly string[] {
    return this.out.get(id) ?? [];
  }

  private walk(seeds: readonly string[], next: (id: string) => readonly string[], skip?: string): Set<string> {
    const seen = new Set<string>();
    const pending = seeds.filter((seed) => seed !== skip);
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const target of next(id)) if (target !== skip && !seen.has(target)) pending.push(target);
    }
    return seen;
  }

  /** Blocks reachable from any START. */
  reachableFromStarts(): Set<string> {
    return this.walk(this.starts, (id) => this.exitsOf(id));
  }

  /** Blocks from which an END can be reached. */
  canReachEnd(): Set<string> {
    return this.walk(this.ends, (id) => this.inn.get(id) ?? []);
  }

  /** Blocks that can reach `id` (itself included). */
  ancestorsOf(id: string): Set<string> {
    return this.walk([id], (node) => this.inn.get(node) ?? []);
  }

  /**
   * `dominator` dominates `block` when every path from a START to `block` goes through it (a block
   * dominates itself): removing it makes `block` unreachable.
   */
  dominates(dominator: string, block: string): boolean {
    if (dominator === block) return true;
    let without = this.withoutCache.get(dominator);
    if (without === undefined) {
      without = this.walk(this.starts, (id) => this.exitsOf(id), dominator);
      this.withoutCache.set(dominator, without);
    }
    return !without.has(block);
  }

  /** Strongly connected components that contain a cycle (more than one block, or a self-loop). */
  loops(): string[][] {
    let counter = 0;
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const loops: string[][] = [];
    const visit = (id: string): void => {
      index.set(id, counter);
      low.set(id, counter);
      counter += 1;
      stack.push(id);
      onStack.add(id);
      for (const target of this.exitsOf(id)) {
        if (!index.has(target)) {
          visit(target);
          low.set(id, Math.min(low.get(id)!, low.get(target)!));
        } else if (onStack.has(target)) {
          low.set(id, Math.min(low.get(id)!, index.get(target)!));
        }
      }
      if (low.get(id) === index.get(id)) {
        const component: string[] = [];
        let member: string;
        do {
          member = stack.pop()!;
          onStack.delete(member);
          component.push(member);
        } while (member !== id);
        if (component.length > 1 || this.exitsOf(id).includes(id)) loops.push(component.reverse());
      }
    };
    for (const node of this.nodes) if (!index.has(node.id)) visit(node.id);
    return loops;
  }
}
