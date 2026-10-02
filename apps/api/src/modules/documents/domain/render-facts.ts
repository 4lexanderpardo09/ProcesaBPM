import type { FieldDocument } from '@procesabpm/shared';

/** Who signed a step, and the signature image to draw when the person has one. */
export interface SignerRecord {
  readonly userId: string;
  readonly name: string;
  readonly signedAt: Date;
  /** Key of the image in the renderer's image map; `null` when the person has no usable signature image. */
  readonly imageKey: string | null;
}

export interface TicketFacts {
  readonly number: string;
  readonly title: string;
  readonly status: 'OPEN' | 'PAUSED' | 'CLOSED';
  readonly createdAt: Date;
  readonly closedAt: Date | null;
  readonly companyName: string;
  readonly creatorId: string;
  readonly creatorName: string;
  readonly currentStepName: string | null;
}

export interface NameLookups {
  readonly users: ReadonlyMap<string, string>;
  readonly sites: ReadonlyMap<string, string>;
  readonly files: ReadonlyMap<string, string>;
}

/** Everything a document needs from the database, already read: resolving a document is then pure. */
export interface RenderFacts {
  readonly ticket: TicketFacts;
  readonly timeZone: string;
  readonly currencyCode: string;
  /** The fields of the ticket's workflow version, in order. */
  readonly fields: readonly FieldDocument[];
  /** Raw stored values by field code. */
  readonly values: Readonly<Record<string, unknown>>;
  readonly names: NameLookups;
  /** By step name: who signed it, in the order they did. */
  readonly signers: ReadonlyMap<string, readonly SignerRecord[]>;
  readonly now: Date;
}
