import { InvalidStateError } from '@procesabpm/shared';
import { describe, expect, it } from 'vitest';
import { cancellationOf } from './delegation-cancellation.js';

const at = (iso: string) => new Date(iso);
const now = at('2026-10-10T12:00:00Z');

describe('cancellationOf', () => {
  it('a future delegation is removed', () => {
    expect(cancellationOf({ startsAt: at('2026-10-11T00:00:00Z'), endsAt: at('2026-10-12T00:00:00Z') }, now)).toBe('DELETE');
  });

  it('a delegation in force ends now; one starting exactly now is removed', () => {
    expect(cancellationOf({ startsAt: at('2026-10-09T00:00:00Z'), endsAt: at('2026-10-12T00:00:00Z') }, now)).toBe('END_NOW');
    expect(cancellationOf({ startsAt: now, endsAt: at('2026-10-12T00:00:00Z') }, now)).toBe('DELETE');
  });

  it('a delegation that ended (also exactly now) cannot be cancelled', () => {
    expect(() => cancellationOf({ startsAt: at('2026-10-01T00:00:00Z'), endsAt: at('2026-10-05T00:00:00Z') }, now)).toThrow(InvalidStateError);
    expect(() => cancellationOf({ startsAt: at('2026-10-01T00:00:00Z'), endsAt: now }, now)).toThrow(InvalidStateError);
  });
});
