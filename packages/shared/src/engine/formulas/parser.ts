import { tokenize, type Token } from './lexer.js';
import { SIGNATURES, CONTROL_FUNCTIONS, type ParameterType } from './signatures.js';
import { FORMULA_LIMITS, type BinaryOperator, type CompileResult, type Expression, type FormulaIssue, type FormulaSchema, type FormulaType } from './types.js';

type Typed = { readonly expr: Expression; readonly type: FormulaType; /** Of a LIST: the type of its cells. */ readonly element?: FormulaType };

class Abort extends Error {
  constructor(readonly issue: FormulaIssue) {
    super(issue.code);
  }
}

const COMPARISON = new Set(['=', '!=', '<', '<=', '>', '>=']);
const ADDITIVE = new Set(['+', '-']);
const MULTIPLICATIVE = new Set(['*', '/', '%']);

function accepts(parameter: ParameterType, type: FormulaType): boolean {
  if (parameter === 'SCALAR') return type === 'NUMBER' || type === 'TEXT' || type === 'DATE';
  if (parameter === 'NUMBERS') return type === 'NUMBER' || type === 'LIST';
  return parameter === type;
}

class Parser {
  private index = 0;
  private depth = 0;
  private nodes = 0;
  private readonly references = new Set<string>();

  constructor(
    private readonly tokens: readonly Token[],
    private readonly schema: FormulaSchema,
  ) {}

  parseAll(): { typed: Typed; references: string[] } {
    const typed = this.orExpression();
    const rest = this.peek();
    if (rest.kind !== 'end') throw new Abort({ code: 'SYNTAX', position: rest.position, detail: 'UNEXPECTED_TOKEN' });
    return { typed, references: [...this.references] };
  }

  private peek(): Token {
    return this.tokens[this.index]!;
  }

  private take(): Token {
    return this.tokens[this.index++]!;
  }

  private isSymbol(value: string): boolean {
    const token = this.peek();
    return token.kind === 'symbol' && token.value === value;
  }

  private expectSymbol(value: string): void {
    const token = this.take();
    if (token.kind !== 'symbol' || token.value !== value) throw new Abort({ code: 'SYNTAX', position: token.position, detail: `EXPECTED_${value}` });
  }

  private node<T extends Expression>(expr: T): T {
    this.nodes += 1;
    if (this.nodes > FORMULA_LIMITS.nodes) throw new Abort({ code: 'TOO_COMPLEX', position: this.peek().position });
    return expr;
  }

  private nested<T>(action: () => T): T {
    this.depth += 1;
    if (this.depth > FORMULA_LIMITS.depth) throw new Abort({ code: 'TOO_DEEP', position: this.peek().position });
    try {
      return action();
    } finally {
      this.depth -= 1;
    }
  }

  private requireType(typed: Typed, expected: FormulaType, position: number): void {
    if (typed.type !== expected) throw new Abort({ code: typed.type === 'LIST' ? 'LIST_OUTSIDE_AGGREGATE' : 'TYPE_MISMATCH', position, detail: `${expected}<-${typed.type}` });
  }

  private binaryLevel(next: () => Typed, operators: ReadonlySet<string>, combine: (left: Typed, right: Typed, operator: BinaryOperator, position: number) => FormulaType): Typed {
    let left = next();
    for (;;) {
      const token = this.peek();
      if (token.kind !== 'symbol' || !operators.has(token.value)) return left;
      this.take();
      const right = next();
      const type = combine(left, right, token.value as BinaryOperator, token.position);
      left = { expr: this.node({ kind: 'binary', operator: token.value as BinaryOperator, left: left.expr, right: right.expr }), type };
    }
  }

  private orExpression(): Typed {
    return this.nested(() => this.binaryLevel(() => this.andExpression(), new Set(['||']), (l, r, _o, at) => this.logical(l, r, at)));
  }

  private andExpression(): Typed {
    return this.binaryLevel(() => this.comparison(), new Set(['&&']), (l, r, _o, at) => this.logical(l, r, at));
  }

  private logical(left: Typed, right: Typed, position: number): FormulaType {
    this.requireType(left, 'BOOLEAN', position);
    this.requireType(right, 'BOOLEAN', position);
    return 'BOOLEAN';
  }

  private comparison(): Typed {
    return this.binaryLevel(() => this.additive(), COMPARISON, (left, right, _operator, position) => {
      if (left.type === 'LIST' || right.type === 'LIST') throw new Abort({ code: 'LIST_OUTSIDE_AGGREGATE', position });
      if (left.type !== right.type) throw new Abort({ code: 'TYPE_MISMATCH', position, detail: `${left.type}/${right.type}` });
      return 'BOOLEAN';
    });
  }

  private arithmetic(left: Typed, right: Typed, position: number): FormulaType {
    this.requireType(left, 'NUMBER', position);
    this.requireType(right, 'NUMBER', position);
    return 'NUMBER';
  }

  private additive(): Typed {
    return this.binaryLevel(() => this.multiplicative(), ADDITIVE, (l, r, _o, at) => this.arithmetic(l, r, at));
  }

  private multiplicative(): Typed {
    return this.binaryLevel(() => this.unary(), MULTIPLICATIVE, (l, r, _o, at) => this.arithmetic(l, r, at));
  }

  private unary(): Typed {
    const token = this.peek();
    if (token.kind === 'symbol' && (token.value === '-' || token.value === '!')) {
      this.take();
      const operand = this.nested(() => this.unary());
      this.requireType(operand, token.value === '-' ? 'NUMBER' : 'BOOLEAN', token.position);
      return { expr: this.node({ kind: 'unary', operator: token.value, operand: operand.expr }), type: operand.type };
    }
    return this.primary();
  }

  private primary(): Typed {
    const token = this.take();
    switch (token.kind) {
      case 'number':
        return { expr: this.node({ kind: 'number', value: token.value }), type: 'NUMBER' };
      case 'text':
        return { expr: this.node({ kind: 'text', value: token.value }), type: 'TEXT' };
      case 'name':
        return this.isSymbol('(') ? this.call(token) : this.reference(token);
      case 'symbol':
        if (token.value === '(') {
          const inner = this.nested(() => this.orExpression());
          this.expectSymbol(')');
          return inner;
        }
        throw new Abort({ code: 'SYNTAX', position: token.position, detail: 'UNEXPECTED_TOKEN' });
      case 'end':
        throw new Abort({ code: 'SYNTAX', position: token.position, detail: 'UNEXPECTED_END' });
    }
  }

  private reference(token: Extract<Token, { kind: 'name' }>): Typed {
    if (token.value === 'TRUE' || token.value === 'FALSE') return { expr: this.node({ kind: 'boolean', value: token.value === 'TRUE' }), type: 'BOOLEAN' };
    const shape = this.schema.fields.get(token.value);
    if (shape === undefined) throw new Abort({ code: 'UNKNOWN_FIELD', position: token.position, detail: token.value });
    this.references.add(token.value);
    if (shape.kind === 'value') return { expr: this.node({ kind: 'field', code: token.value, type: shape.type }), type: shape.type };
    this.expectSymbol('.');
    const column = this.take();
    if (column.kind !== 'name') throw new Abort({ code: 'SYNTAX', position: column.position, detail: 'EXPECTED_COLUMN' });
    const columnType = shape.columns.get(column.value);
    if (columnType === undefined) throw new Abort({ code: 'UNKNOWN_COLUMN', position: column.position, detail: `${token.value}.${column.value}` });
    return { expr: this.node({ kind: 'column', table: token.value, column: column.value, type: columnType }), type: 'LIST', element: columnType };
  }

  private arguments(): { typed: Typed; position: number }[] {
    const args: { typed: Typed; position: number }[] = [];
    this.expectSymbol('(');
    if (this.isSymbol(')')) {
      this.take();
      return args;
    }
    for (;;) {
      const position = this.peek().position;
      args.push({ typed: this.nested(() => this.orExpression()), position });
      const separator = this.take();
      if (separator.kind === 'symbol' && separator.value === ')') return args;
      if (separator.kind !== 'symbol' || separator.value !== ',') throw new Abort({ code: 'SYNTAX', position: separator.position, detail: 'EXPECTED_,_OR_)' });
    }
  }

  private call(name: Extract<Token, { kind: 'name' }>): Typed {
    const args = this.arguments();
    const expr = (): Expression => this.node({ kind: 'call', name: name.value, args: args.map((arg) => arg.typed.expr) });
    if (CONTROL_FUNCTIONS.has(name.value)) return this.controlCall(name, args, expr);
    const signature = Object.hasOwn(SIGNATURES, name.value) ? SIGNATURES[name.value] : undefined;
    if (signature === undefined) throw new Abort({ code: 'UNKNOWN_FUNCTION', position: name.position, detail: name.value });
    const required = signature.parameters.length - (signature.optional ?? 0);
    if (args.length < required || (signature.rest === undefined && args.length > signature.parameters.length)) {
      throw new Abort({ code: 'WRONG_ARGUMENT_COUNT', position: name.position, detail: name.value });
    }
    args.forEach((arg, position) => {
      const parameter = signature.parameters[position] ?? signature.rest!;
      const cellsAreNumbers = arg.typed.type !== 'LIST' || name.value === 'COUNT' || arg.typed.element === 'NUMBER';
      if (!accepts(parameter, arg.typed.type) || !cellsAreNumbers) {
        throw new Abort({ code: arg.typed.type === 'LIST' ? 'LIST_OUTSIDE_AGGREGATE' : 'TYPE_MISMATCH', position: arg.position, detail: `${name.value}#${position + 1}` });
      }
    });
    return { expr: expr(), type: signature.returns };
  }

  private controlCall(name: Extract<Token, { kind: 'name' }>, args: { typed: Typed; position: number }[], expr: () => Expression): Typed {
    const expected = name.value === 'IF' ? 3 : 2;
    if (args.length !== expected) throw new Abort({ code: 'WRONG_ARGUMENT_COUNT', position: name.position, detail: name.value });
    if (name.value === 'IF') this.requireType(args[0]!.typed, 'BOOLEAN', args[0]!.position);
    const [first, second] = name.value === 'IF' ? [args[1]!, args[2]!] : [args[0]!, args[1]!];
    if (first.typed.type === 'LIST' || first.typed.type !== second.typed.type) {
      throw new Abort({ code: first.typed.type === 'LIST' ? 'LIST_OUTSIDE_AGGREGATE' : 'TYPE_MISMATCH', position: second.position, detail: `${name.value} branches` });
    }
    return { expr: expr(), type: first.typed.type };
  }
}

/** Parses and type-checks a formula against the form it belongs to. Stops at the first problem. */
export function compileFormula(source: string, schema: FormulaSchema): CompileResult {
  const lexed = tokenize(source);
  if (!lexed.ok) return { ok: false, issues: [lexed.issue] };
  try {
    const { typed, references } = new Parser(lexed.tokens, schema).parseAll();
    if (typed.type === 'LIST') return { ok: false, issues: [{ code: 'LIST_OUTSIDE_AGGREGATE', position: 0 }] };
    return { ok: true, formula: { source, expression: typed.expr, type: typed.type, references } };
  } catch (error) {
    if (error instanceof Abort) return { ok: false, issues: [error.issue] };
    throw error;
  }
}
