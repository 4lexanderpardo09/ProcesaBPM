import { describe, expect, it } from 'vitest';
import { assignSigners, type SignatureSlot } from './signer-assignment.js';
import type { SignerRecord } from './render-facts.js';

const signer = (userId: string, minute: number): SignerRecord => ({ userId, name: userId, signedAt: new Date(Date.UTC(2026, 9, 2, 10, minute)), imageKey: null });
const slot = (signerType: SignatureSlot['signerType']): SignatureSlot => ({ stepName: 'Firma', signerType });

describe('assignSigners', () => {
  it('fills the slots in the order people signed', () => {
    const chosen = assignSigners([slot('USER'), slot('POSITION')], [signer('a', 1), signer('b', 2)], 'creator');
    expect(chosen.map((record) => record?.userId)).toEqual(['a', 'b']);
  });

  it('gives the creator slot to the creator wherever they signed', () => {
    const chosen = assignSigners([slot('USER'), slot('CREATOR')], [signer('a', 1), signer('creator', 2)], 'creator');
    expect(chosen.map((record) => record?.userId)).toEqual(['a', 'creator']);
  });

  it('leaves a slot empty when nobody is left, and never uses a person twice', () => {
    const chosen = assignSigners([slot('USER'), slot('USER'), slot('CREATOR')], [signer('a', 1)], 'creator');
    expect(chosen.map((record) => record?.userId)).toEqual(['a', undefined, undefined]);
  });

  it('a creator slot nobody filled does not take somebody else', () => {
    expect(assignSigners([slot('CREATOR')], [signer('a', 1)], 'creator')).toEqual([undefined]);
  });
});
