import { describe, expect, it } from 'vitest';
import { normalizeClientAddress } from './client-address.js';

describe('normalizeClientAddress', () => {
  it('keeps an IPv4 address whole', () => {
    expect(normalizeClientAddress('203.0.113.9')).toBe('203.0.113.9');
  });

  it('treats an IPv4-mapped IPv6 address as IPv4', () => {
    expect(normalizeClientAddress('::ffff:203.0.113.9')).toBe('203.0.113.9');
  });

  it('collapses an IPv6 address to its /64 prefix', () => {
    expect(normalizeClientAddress('2001:db8:1:2:3:4:5:6')).toBe('2001:0db8:0001:0002::/64');
    expect(normalizeClientAddress('2001:0db8:1:2:ffff:ffff:ffff:ffff')).toBe('2001:0db8:0001:0002::/64');
  });

  it('groups two addresses of the same /64 under one key', () => {
    expect(normalizeClientAddress('2001:db8::1')).toBe(normalizeClientAddress('2001:db8::ffff:1'));
  });

  it('keeps different /64 prefixes apart', () => {
    expect(normalizeClientAddress('2001:db8:1:2::1')).not.toBe(normalizeClientAddress('2001:db8:1:3::1'));
  });

  it('drops the zone id and handles a compressed address', () => {
    expect(normalizeClientAddress('fe80::1%eth0')).toBe('fe80:0000:0000:0000::/64');
  });

  it('falls back to the raw address when it cannot parse', () => {
    expect(normalizeClientAddress('not-an-address')).toBe('not-an-address');
    expect(normalizeClientAddress('1:2:3')).toBe('1:2:3');
  });

  it('answers unknown for an empty address', () => {
    expect(normalizeClientAddress(undefined)).toBe('unknown');
    expect(normalizeClientAddress('')).toBe('unknown');
  });
});
