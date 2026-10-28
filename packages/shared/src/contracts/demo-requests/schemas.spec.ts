import { describe, expect, it } from 'vitest';
import { demoRequestSchema, markDemoRequestSchema } from './schemas.js';

const valid = { fullName: ' Laura Méndez ', company: 'Distribuidora del Valle', email: ' Laura@Example.COM ', teamSize: 'FROM_20_TO_100', privacyConsent: true };

describe('demoRequestSchema', () => {
  it('trims the text and lowercases the e-mail', () => {
    expect(demoRequestSchema.parse(valid)).toMatchObject({ fullName: 'Laura Méndez', email: 'laura@example.com' });
  });

  it('asks for the consent to the privacy notice', () => {
    expect(demoRequestSchema.safeParse({ ...valid, privacyConsent: false }).success).toBe(false);
    const { privacyConsent: _omitted, ...withoutConsent } = valid;
    expect(demoRequestSchema.safeParse(withoutConsent).success).toBe(false);
  });

  it('keeps to the limits the database checks', () => {
    expect(demoRequestSchema.safeParse({ ...valid, fullName: 'L' }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...valid, company: 'x'.repeat(161) }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...valid, process: 'x'.repeat(2001) }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(demoRequestSchema.safeParse({ ...valid, teamSize: 'HUGE' }).success).toBe(false);
  });

  it('accepts the hidden field, so a bot that fills it is answered as anyone else', () => {
    expect(demoRequestSchema.parse({ ...valid, website: 'http://spam.example' }).website).toBe('http://spam.example');
  });
});

describe('markDemoRequestSchema', () => {
  it('never takes a request back to NEW', () => {
    expect(markDemoRequestSchema.safeParse({ status: 'NEW' }).success).toBe(false);
    expect(markDemoRequestSchema.parse({ status: 'CONTACTED' })).toEqual({ status: 'CONTACTED' });
  });
});
