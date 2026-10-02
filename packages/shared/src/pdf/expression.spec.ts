import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatDate, normalizePdfText, parseExpression, pathsOf, type PdfValue, type Path } from './expression.js';

const parse = (text: string) => {
  const result = parseExpression(text);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.expression;
};
const errorsOf = (text: string) => {
  const result = parseExpression(text);
  return result.ok ? [] : result.errors.map((error) => error.code);
};
const values: Record<string, PdfValue> = { 'field.AMOUNT': '1500000.5', 'field.NAME': 'señor Muñoz', 'field.DAY': '2026-03-05', 'field.EMPTY': '', 'field.FLAG': true, 'ticket.number': '1045', 'step.Revisión.completedBy': 'Ana Gómez', 'row.QTY': 3 };
const resolve = (path: Path): PdfValue | undefined => {
  const key = path.kind === 'step' ? `step.${path.stepName}.${path.property}` : path.kind === 'ticket' ? `ticket.${path.name}` : path.kind === 'field' || path.kind === 'row' ? `${path.kind}.${path.code}` : undefined;
  return key === undefined ? undefined : values[key];
};
const context = { resolve, timeZone: 'America/Bogota', currencyCode: 'COP', now: new Date('2026-10-02T03:30:00Z') };
const run = (text: string) => evaluateExpression(parse(text), context);

describe('parseExpression', () => {
  it('parses text with placeholders, paths and formatters', () => {
    const expression = parse(`Ticket {{ticket.number}} de {{field.NAME|upper}} el {{field.DAY|date:'dd/MM/yyyy'}}`);
    expect(pathsOf(expression)).toEqual([{ kind: 'ticket', name: 'number' }, { kind: 'field', code: 'NAME' }, { kind: 'field', code: 'DAY' }]);
  });
  it('knows step paths with spaces and accents, now, page and pages', () => {
    expect(pathsOf(parse('{{step.Revisión legal.completedBy}} {{now}} {{page}}/{{pages}}'))).toEqual([{ kind: 'step', stepName: 'Revisión legal', property: 'completedBy' }, { kind: 'now' }, { kind: 'page' }, { kind: 'pages' }]);
  });
  it.each(['{{constructor}}', '{{__proto__}}', '{{field.lower}}', '{{field.A.B}}', '{{ticket.password}}', '{{field}}', '{{ }}', '{{step.X.other}}', '{{process.env.HOME}}'])('rejects the path in %s', (text) => {
    expect(errorsOf(text).length).toBeGreaterThan(0);
  });
  it('rejects unknown formatters, bad arguments, unclosed and nested placeholders', () => {
    expect(errorsOf('{{field.A|eval}}')).toEqual(['UNKNOWN_FORMATTER']);
    expect(errorsOf('{{field.A|date:yyyy/dd}}')).toEqual(['BAD_ARGUMENT']);
    expect(errorsOf('{{field.A|number:9}}')).toEqual(['BAD_ARGUMENT']);
    expect(errorsOf('{{field.A|upper:x}}')).toEqual(['BAD_ARGUMENT']);
    expect(errorsOf('{{field.A')).toEqual(['UNCLOSED']);
    expect(errorsOf('{{field.{{A}}}}').length).toBeGreaterThan(0);
  });
  it('caps the length and the number of placeholders, and reports positions', () => {
    expect(errorsOf('x'.repeat(2001))).toEqual(['TOO_LONG']);
    expect(errorsOf('{{field.A}}'.repeat(51))).toEqual(['TOO_MANY_PLACEHOLDERS']);
    const result = parseExpression('ok {{bad}}');
    expect(result.ok ? [] : result.errors.map((error) => error.position)).toEqual([3]);
  });
  it('a pipe inside the quoted argument of default is not a separator', () => {
    expect(run(`{{field.EMPTY|default:'a|b'}}`)).toBe('a|b');
  });
});

describe('evaluateExpression', () => {
  it('formats dates in the company time zone and calendar dates as written', () => {
    expect(run('{{now|datetime}}')).toBe('01/10/2026 22:30');
    expect(run('{{field.DAY|date}}')).toBe('05/03/2026');
    expect(run(`{{field.DAY|date:'dd MMM yyyy'}}`)).toBe('05 mar 2026');
    expect(run(`{{field.DAY|date:'MMMM yyyy'}}`)).toBe('marzo 2026');
  });
  it('prints a calendar date the way people write it when no formatter is given', () => {
    expect(run('{{field.DAY}}')).toBe('05/03/2026');
  });
  it('formats numbers and currency for es-CO', () => {
    expect(run('{{field.AMOUNT|number:2}}')).toBe('1.500.000,50');
    expect(run('{{field.AMOUNT|currency}}')).toMatch(/1\.500\.000,50/);
    expect(run('{{row.QTY}}')).toBe('3');
  });
  it('upper and lower use Spanish rules; yesno and default fill the gaps', () => {
    expect(run('{{field.NAME|upper}}')).toBe('SEÑOR MUÑOZ');
    expect(run('{{field.NAME|lower}}')).toBe('señor muñoz');
    expect(run('{{field.FLAG|yesno}}')).toBe('Sí');
    expect(run(`{{field.MISSING|default:'—'}}`)).toBe('—');
    expect(run('[{{field.MISSING}}]')).toBe('[]');
  });
  it('resolves tickets and steps', () => {
    expect(run('#{{ticket.number}} firmado por {{step.Revisión.completedBy}}')).toBe('#1045 firmado por Ana Gómez');
  });
  it('a value that looks like a placeholder is data, never evaluated again', () => {
    values['field.TRICKY'] = '{{ticket.number}}';
    expect(run('{{field.TRICKY}}')).toBe('{{ticket.number}}');
  });
});

describe('normalizePdfText', () => {
  it('composes accents, drops control characters, keeps newlines and turns tabs into spaces', () => {
    expect(normalizePdfText('año\u0000\u0007\ta\nb')).toBe('año a\nb');
  });
});

describe('formatDate', () => {
  it('uses the time zone for the day', () => {
    expect(formatDate(new Date('2026-10-02T03:30:00Z'), 'dd/MM/yyyy', 'America/Bogota')).toBe('01/10/2026');
    expect(formatDate(new Date('2026-10-02T03:30:00Z'), 'dd/MM/yyyy', 'UTC')).toBe('02/10/2026');
  });
});
