import type { SignerChoice, SignerChoices } from '@procesabpm/shared';
import { useState } from 'react';

/** The option that leaves a signature out instead of naming who signs. */
export const SKIP_SIGNATURE = 'skip';

/** What to send as `signerChoices`: nothing to choose, the answers, or "stop: some signer has no answer yet". */
export type SignerChoicesRequest = { readonly ok: true; readonly signerChoices?: SignerChoices } | { readonly ok: false };

/**
 * Who signs for each signer of the next PARALLEL step the preview lists (one that resolved to nobody or to several
 * holders, or any of them when the step lets every signature be chosen): a member of the company, or the signature
 * left out. A signer the step resolved starts on that person. Every listed signer needs an answer before sending; answers for signers no
 * longer listed (the values typed sent the ticket elsewhere) are dropped.
 */
export function useSignerChoices(offered: readonly SignerChoice[] | undefined) {
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({});
  const [missing, setMissing] = useState(false);
  const signers = offered ?? [];
  const answerOf = (signer: SignerChoice) => {
    // A step that lets every signature be chosen offers the person it resolved to.
    const answer = answers[signer.signerId] ?? signer.suggestedId ?? '';
    return answer === SKIP_SIGNATURE || signer.candidates.some((candidate) => candidate.id === answer) ? answer : '';
  };
  return {
    signers,
    missing,
    answerOf,
    answer(signerId: string, value: string) {
      setAnswers((current) => ({ ...current, [signerId]: value }));
      setMissing(false);
    },
    request(): SignerChoicesRequest {
      if (signers.length === 0) return { ok: true };
      if (signers.some((signer) => answerOf(signer) === '')) {
        setMissing(true);
        return { ok: false };
      }
      return { ok: true, signerChoices: signers.map((signer) => ({ signerId: signer.signerId, userId: answerOf(signer) === SKIP_SIGNATURE ? null : answerOf(signer) })) };
    },
  };
}

export type SignerChoicesState = ReturnType<typeof useSignerChoices>;
