import { describe, expect, it } from 'vitest';
import { assignSigners, type SignatureSlot } from './signer-assignment.js';
import type { ConfiguredSigner, SignerRecord } from './render-facts.js';

const signer = (userId: string, minute: number): SignerRecord => ({ userId, name: userId, signedAt: new Date(Date.UTC(2026, 9, 2, 10, minute)), imageKey: null, positionId: null });
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

  describe('in a step whose signatures know their area (PARALLEL)', () => {
    const area = (userId: string, minute: number, signerId: string | null): SignerRecord => ({ ...signer(userId, minute), signerId });
    const rows: ConfiguredSigner[] = [
      { id: 'boss', signerType: 'APPROVER', label: 'Jefe inmediato' },
      { id: 'assets', signerType: 'POSITION', label: 'Activos fijos' },
      { id: 'debts', signerType: 'POSITION', label: 'Cartera' },
    ];
    const labelled = (signerType: SignatureSlot['signerType'], signerLabel: string): SignatureSlot => ({ stepName: 'Áreas', signerType, signerLabel });
    const slots = [labelled('APPROVER', 'Jefe inmediato'), labelled('POSITION', 'Activos fijos'), labelled('POSITION', 'Cartera')];

    it('puts each signature in its area box, whatever the order they signed in', () => {
      const chosen = assignSigners(slots, [area('carla', 1, 'debts'), area('jorge', 2, 'boss'), area('fabio', 3, 'assets')], 'creator', rows);
      expect(chosen.map((record) => record?.userId)).toEqual(['jorge', 'fabio', 'carla']);
    });

    it('an area that has not signed stays empty instead of taking somebody else (labels compare loosely)', () => {
      const chosen = assignSigners([labelled('APPROVER', 'jefe inmediato '), ...slots.slice(1)], [area('carla', 1, 'debts')], 'creator', rows);
      expect(chosen.map((record) => record?.userId)).toEqual([undefined, undefined, 'carla']);
    });

    it('a slot that names no row, and a signer added by hand, keep the order of signing', () => {
      const chosen = assignSigners([labelled('POSITION', 'Cartera'), slot('USER')], [area('extra', 1, null), area('carla', 2, 'debts')], 'creator', rows);
      expect(chosen.map((record) => record?.userId)).toEqual(['carla', 'extra']);
    });
  });
});
