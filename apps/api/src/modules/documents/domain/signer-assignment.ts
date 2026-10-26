import type { ConfiguredSigner, SignerRecord } from './render-facts.js';

export interface SignatureSlot {
  readonly stepName: string;
  readonly signerType: 'USER' | 'POSITION' | 'APPROVER' | 'CREATOR' | 'STEP_ASSIGNEE';
  readonly signerLabel?: string | undefined;
}

const sameLabel = (left: string | null | undefined, right: string | null | undefined): boolean => (left ?? '').trim().toLowerCase() === (right ?? '').trim().toLowerCase();

/**
 * Chooses who fills each slot of one step. The creator's slot takes the creator when they signed. In a step whose
 * signatures know their signer row (PARALLEL), a slot that names one of the step's rows (same type and label) takes
 * only that row's signature, whatever the order people signed in, and stays empty until that area signs (as the help
 * desk does by position): never somebody else's. Every other slot takes the next person who signed, in the order they
 * did. A slot nobody fills stays `undefined` (a pending box).
 */
export function assignSigners(slots: readonly SignatureSlot[], signers: readonly SignerRecord[], creatorId: string, configured: readonly ConfiguredSigner[] = []): Array<SignerRecord | undefined> {
  const taken = new Set<string>();
  const chosen: Array<SignerRecord | undefined> = slots.map(() => undefined);
  const byRow = signers.some((signer) => signer.signerId !== undefined && signer.signerId !== null);
  const usedRows = new Set<string>();
  const rowOf = (slot: SignatureSlot): ConfiguredSigner | undefined => {
    const row = configured.find((candidate) => !usedRows.has(candidate.id) && candidate.signerType === slot.signerType && (slot.signerLabel === undefined || sameLabel(candidate.label, slot.signerLabel)));
    if (row !== undefined) usedRows.add(row.id);
    return row;
  };
  const rowSlots = new Set<number>();
  if (byRow) {
    slots.forEach((slot, index) => {
      const row = rowOf(slot);
      if (row === undefined) return;
      rowSlots.add(index);
      const signature = signers.find((signer) => signer.signerId === row.id && !taken.has(signer.userId));
      if (signature !== undefined) {
        chosen[index] = signature;
        taken.add(signature.userId);
      }
    });
  }
  slots.forEach((slot, index) => {
    if (slot.signerType !== 'CREATOR' || rowSlots.has(index)) return;
    const creator = signers.find((signer) => signer.userId === creatorId && !taken.has(signer.userId));
    if (creator !== undefined) {
      chosen[index] = creator;
      taken.add(creator.userId);
    }
  });
  slots.forEach((slot, index) => {
    if (slot.signerType === 'CREATOR' || rowSlots.has(index)) return;
    const next = signers.find((signer) => !taken.has(signer.userId));
    if (next !== undefined) {
      chosen[index] = next;
      taken.add(next.userId);
    }
  });
  return chosen;
}
