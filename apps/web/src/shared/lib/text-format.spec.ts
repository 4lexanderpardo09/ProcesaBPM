import { describe, expect, it } from 'vitest';
import { listLines, wrapSelection } from './text-format';

describe('wrapSelection', () => {
  it('wraps the selection, leaving its spaces outside, and keeps it selected', () => {
    expect(wrapSelection('uno dos tres', 4, 8, '**')).toEqual({ text: 'uno **dos** tres', start: 6, end: 9 });
  });

  it('leaves an empty pair to type in when nothing is selected', () => {
    expect(wrapSelection('hola ', 5, 5, '_')).toEqual({ text: 'hola __', start: 6, end: 6 });
  });
});

describe('listLines', () => {
  it('starts each touched line with a dash, in a block of its own', () => {
    expect(listLines('Falta:\nla cédula\nel RUT', 8, 20, false)).toEqual({ text: 'Falta:\n\n- la cédula\n- el RUT', start: 8, end: 28 });
  });

  it('numbers the lines, replacing the marks they had', () => {
    expect(listLines('- firmar\n- enviar', 0, 5, true).text).toBe('1. firmar\n- enviar');
    expect(listLines('- firmar\n- enviar', 0, 15, true).text).toBe('1. firmar\n2. enviar');
  });
});
