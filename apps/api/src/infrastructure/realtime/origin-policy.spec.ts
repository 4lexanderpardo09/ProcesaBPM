import { describe, expect, it } from 'vitest';
import { OriginPolicy } from './origin-policy.js';

describe('OriginPolicy', () => {
  const policy = new OriginPolicy(['https://app.example.com', 'http://localhost:5173']);

  it('allows the listed origins, whatever the case', () => {
    expect(policy.allows('https://app.example.com')).toBe(true);
    expect(policy.allows('HTTPS://APP.EXAMPLE.COM')).toBe(true);
    expect(policy.allows('http://localhost:5173')).toBe(true);
  });

  it('refuses an absent origin and the opaque null origin', () => {
    expect(policy.allows(undefined)).toBe(false);
    expect(policy.allows('null')).toBe(false);
    expect(policy.allows('')).toBe(false);
  });

  it('compares scheme, host and port exactly', () => {
    expect(policy.allows('http://app.example.com')).toBe(false);
    expect(policy.allows('https://app.example.com:8443')).toBe(false);
    expect(policy.allows('http://localhost:5174')).toBe(false);
    expect(policy.allows('https://evil.app.example.com')).toBe(false);
    expect(policy.allows('https://app.example.com.evil.test')).toBe(false);
  });

  it('refuses a trailing slash, a path or another scheme', () => {
    expect(policy.allows('https://app.example.com/')).toBe(false);
    expect(policy.allows('https://app.example.com/page')).toBe(false);
    expect(policy.allows('wss://app.example.com')).toBe(false);
    expect(policy.allows('file://app.example.com')).toBe(false);
  });
});
