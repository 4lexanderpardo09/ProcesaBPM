import { DRAFT_STEP_TYPES } from './spec.js';

/** The blocks and connections a model has finished writing so far: what the builder draws while it works. */
export interface DraftPreview {
  readonly steps: ReadonlyArray<{ readonly ref: string; readonly type: (typeof DRAFT_STEP_TYPES)[number]; readonly name: string }>;
  readonly transitions: ReadonlyArray<{ readonly from: string; readonly to: string; readonly label: string }>;
}

/** Bounds of a preview, well inside what the spec allows, so it always fits the 64 KB the database accepts. */
export const DRAFT_PREVIEW_LIMITS = { steps: 60, transitions: 120, text: 120 } as const;

/** A value read from the text, and whether the text holds all of it. */
interface Read {
  readonly value: unknown;
  readonly complete: boolean;
}

/**
 * Reads the beginning of a JSON text that is still being written: the values it holds whole, an array with the
 * elements written so far, an object with the members written so far (a cut array or object counts with what it has).
 * Whatever is cut short and has no parts (a string, a number, a member without its value) is left out, never guessed.
 * Throws a SyntaxError on text that can never become JSON.
 */
export function parsePartialJson(text: string): unknown {
  return new PartialReader(text).value()?.value;
}

class PartialReader {
  private at = 0;

  constructor(private readonly text: string) {}

  /** `undefined`: the text ends before the value starts. */
  value(): Read | undefined {
    this.skipSpace();
    const char = this.text[this.at];
    if (char === undefined) return undefined;
    if (char === '{') return this.object();
    if (char === '[') return this.array();
    if (char === '"') return this.string();
    return this.literal();
  }

  private object(): Read {
    const result: Record<string, unknown> = {};
    this.at += 1;
    for (;;) {
      if (this.next() === undefined) return { value: result, complete: false };
      if (this.text[this.at] === '}') {
        this.at += 1;
        return { value: result, complete: true };
      }
      const key = this.string();
      if (!key.complete || this.next() === undefined) return { value: result, complete: false };
      if (this.text[this.at] !== ':') throw new SyntaxError('expected a colon');
      this.at += 1;
      const member = this.value();
      if (member === undefined) return { value: result, complete: false };
      if (member.complete || isContainer(member.value)) result[key.value as string] = member.value;
      if (!member.complete) return { value: result, complete: false };
      if (!this.separator('}')) return { value: result, complete: false };
    }
  }

  private array(): Read {
    const result: unknown[] = [];
    this.at += 1;
    for (;;) {
      if (this.next() === undefined) return { value: result, complete: false };
      if (this.text[this.at] === ']') {
        this.at += 1;
        return { value: result, complete: true };
      }
      const element = this.value();
      if (element === undefined) return { value: result, complete: false };
      if (element.complete || isContainer(element.value)) result.push(element.value);
      if (!element.complete) return { value: result, complete: false };
      if (!this.separator(']')) return { value: result, complete: false };
    }
  }

  /** After an element or member: a comma (consumed) or the closing bracket (left). `false`: the text ends here. */
  private separator(close: string): boolean {
    const char = this.next();
    if (char === undefined) return false;
    if (char === ',') this.at += 1;
    else if (char !== close) throw new SyntaxError(`expected , or ${close}`);
    return true;
  }

  private string(): Read {
    if (this.text[this.at] !== '"') throw new SyntaxError('expected a string');
    let end = this.at + 1;
    for (;;) {
      const char = this.text[end];
      if (char === undefined) {
        this.at = this.text.length;
        return { value: undefined, complete: false };
      }
      if (char === '\\') end += 2;
      else if (char === '"') break;
      else end += 1;
    }
    const raw = this.text.slice(this.at, end + 1);
    this.at = end + 1;
    return { value: JSON.parse(raw) as string, complete: true };
  }

  /** A number, true, false or null: complete only once something follows it, since `12` may still become `125`. */
  private literal(): Read {
    const match = /^[^,\]}\s]+/.exec(this.text.slice(this.at));
    if (match === null) throw new SyntaxError('unexpected character');
    this.at += match[0].length;
    if (this.at >= this.text.length) return { value: undefined, complete: false };
    return { value: JSON.parse(match[0]) as unknown, complete: true };
  }

  /** The next character that is not white space (`undefined` at the end of the text). */
  private next(): string | undefined {
    this.skipSpace();
    return this.text[this.at];
  }

  private skipSpace(): void {
    while (/\s/.test(this.text[this.at] ?? '')) this.at += 1;
  }
}

const isContainer = (value: unknown): boolean => typeof value === 'object' && value !== null;

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value.slice(0, DRAFT_PREVIEW_LIMITS.text) : undefined);
const STEP_TYPES: ReadonlySet<string> = new Set(DRAFT_STEP_TYPES);

/**
 * The preview in the tool arguments written so far (`submit_workflow_draft`): each step with its ref, type and name
 * already written, each transition between steps already seen. Text that is not JSON yet gives an empty preview.
 */
export function draftPreviewOf(argumentsSoFar: string): DraftPreview {
  let parsed: unknown;
  try {
    parsed = parsePartialJson(argumentsSoFar);
  } catch {
    return { steps: [], transitions: [] };
  }
  const draft = asRecord(parsed);
  const steps: Array<DraftPreview['steps'][number]> = [];
  const refs = new Set<string>();
  for (const raw of Array.isArray(draft.steps) ? draft.steps : []) {
    const step = asRecord(raw);
    const ref = textOf(step.ref);
    const name = textOf(step.name);
    if (ref === undefined || name === undefined || typeof step.type !== 'string' || !STEP_TYPES.has(step.type) || refs.has(ref)) continue;
    if (steps.length === DRAFT_PREVIEW_LIMITS.steps) break;
    refs.add(ref);
    steps.push({ ref, type: step.type as DraftPreview['steps'][number]['type'], name });
  }
  const transitions: Array<DraftPreview['transitions'][number]> = [];
  for (const raw of Array.isArray(draft.transitions) ? draft.transitions : []) {
    const transition = asRecord(raw);
    const from = textOf(transition.from);
    const to = textOf(transition.to);
    const label = textOf(transition.label);
    if (from === undefined || to === undefined || label === undefined || !refs.has(from) || !refs.has(to)) continue;
    if (transitions.length === DRAFT_PREVIEW_LIMITS.transitions) break;
    transitions.push({ from, to, label });
  }
  return { steps, transitions };
}
