import { describe, expect, it } from 'vitest';
import { escapeLike, likeContains } from './like-pattern.js';

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('100% of a_b\\c')).toBe('100\\% of a\\_b\\\\c');
  });

  it('leaves any other text as it is', () => {
    expect(escapeLike('Pérez #42')).toBe('Pérez #42');
  });
});

describe('likeContains', () => {
  it('wraps the escaped text in wildcards', () => {
    expect(likeContains('5%')).toBe('%5\\%%');
  });
});
