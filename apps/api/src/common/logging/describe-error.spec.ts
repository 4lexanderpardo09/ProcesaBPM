import { describe, expect, it } from 'vitest';
import { describeError } from './describe-error.js';

describe('describeError', () => {
  it('gives the name, message and code of an error, and its cause chain', () => {
    const root = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
    const wrapped = Object.assign(new Error('Could not record the failure', { cause: root }), { name: 'OutboxRecordError' });
    expect(describeError(wrapped)).toEqual({
      name: 'OutboxRecordError',
      message: 'Could not record the failure',
      cause: { name: 'Error', message: 'connect ECONNREFUSED 10.0.0.5:5432', code: 'ECONNREFUSED' },
    });
  });

  it('reads what libraries throw that is not an Error: a plain object, a string, nothing', () => {
    expect(describeError({ code: 'P1001', message: 'Can’t reach database server' })).toEqual({ name: 'NonError', message: 'Can’t reach database server', code: 'P1001' });
    expect(describeError({ status: 503 })).toEqual({ name: 'NonError', message: '{"status":503}' });
    expect(describeError('timeout')).toEqual({ name: 'string', message: 'timeout' });
    expect(describeError(undefined)).toEqual({ name: 'undefined', message: 'undefined' });
    expect(JSON.stringify(describeError({ nested: { deep: true } }))).not.toContain('[object Object]');
  });

  it('lists the first errors of an AggregateError and stops on a cause that loops', () => {
    const many = new AggregateError([new Error('a'), new Error('b'), new Error('c'), new Error('d')], 'All attempts failed');
    expect(describeError(many).errors?.map((error) => error.message)).toEqual(['a', 'b', 'c']);
    const looping = new Error('loop');
    (looping as { cause?: unknown }).cause = looping;
    expect(JSON.stringify(describeError(looping)).match(/"loop"/g)).toHaveLength(5);
  });

  it('clips long messages', () => {
    expect(describeError(new Error('x'.repeat(2_000))).message).toHaveLength(500);
  });

  it('hides the e-mail addresses a provider message echoes', () => {
    expect(describeError(new Error('550 5.1.1 <ana.perez+1@acme.co> recipient rejected')).message).toBe('550 5.1.1 <<email>> recipient rejected');
  });
});
