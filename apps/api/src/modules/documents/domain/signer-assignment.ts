import type { SignerRecord } from './render-facts.js';

export interface SignatureSlot {
  readonly stepName: string;
  readonly signerType: 'USER' | 'POSITION' | 'APPROVER' | 'CREATOR' | 'STEP_ASSIGNEE';
  readonly signerLabel?: string | undefined;
}

/**
 * Chooses who fills each slot of one step. The creator's slot takes the creator when they signed; every other slot
 * takes the next person who signed, in the order they did. A slot nobody fills stays `undefined` (a pending box).
 */
export function assignSigners(slots: readonly SignatureSlot[], signers: readonly SignerRecord[], creatorId: string): Array<SignerRecord | undefined> {
  const taken = new Set<string>();
  const chosen: Array<SignerRecord | undefined> = slots.map(() => undefined);
  slots.forEach((slot, index) => {
    if (slot.signerType !== 'CREATOR') return;
    const creator = signers.find((signer) => signer.userId === creatorId && !taken.has(signer.userId));
    if (creator !== undefined) {
      chosen[index] = creator;
      taken.add(creator.userId);
    }
  });
  slots.forEach((slot, index) => {
    if (slot.signerType === 'CREATOR') return;
    const next = signers.find((signer) => !taken.has(signer.userId));
    if (next !== undefined) {
      chosen[index] = next;
      taken.add(next.userId);
    }
  });
  return chosen;
}
