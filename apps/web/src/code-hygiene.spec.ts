import { describe, expect, it } from 'vitest';

/**
 * Stand-in for lint rules until ESLint arrives: user content is never rendered as HTML, and nothing
 * (tokens included) is written to the console from application code.
 */
const sources = import.meta.glob<string>(['./**/*.{ts,tsx}', '!./code-hygiene.spec.ts'], { query: '?raw', import: 'default', eager: true });
const isTest = (path: string) => /\.(test|spec)\.tsx?$/.test(path) || path.startsWith('./test/');

const offenders = (pattern: RegExp, include: (path: string) => boolean) =>
  Object.entries(sources)
    .filter(([path, source]) => include(path) && pattern.test(source))
    .map(([path]) => path);

describe('code hygiene', () => {
  it('reads the sources', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it('never renders HTML from strings', () => {
    expect(offenders(/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/, () => true)).toEqual([]);
  });

  it('never writes to the console from application code', () => {
    expect(offenders(/\bconsole\.\w+\s*\(/, (path) => !isTest(path))).toEqual([]);
  });
});
