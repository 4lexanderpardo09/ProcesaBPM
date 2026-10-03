import type { BlockRecipient } from '../data/ticket-facts.repository.js';

/** What the recipients of a block are resolved from, already read from the database. */
export interface RecipientSources {
  readonly creatorId: string;
  readonly assigneeIds: readonly string[];
  readonly observerIds: readonly string[];
  readonly positionMembers: ReadonlyMap<string, readonly string[]>;
  readonly groupMembers: ReadonlyMap<string, readonly string[]>;
}

/** The people a block names, each once, in a stable order. Whether they may read the ticket is decided later. */
export function resolveBlockRecipients(recipients: readonly BlockRecipient[], sources: RecipientSources): string[] {
  const ids = new Set<string>();
  for (const recipient of recipients) {
    switch (recipient.kind) {
      case 'CREATOR':
        ids.add(sources.creatorId);
        break;
      case 'ASSIGNEES':
        sources.assigneeIds.forEach((id) => ids.add(id));
        break;
      case 'OBSERVERS':
        sources.observerIds.forEach((id) => ids.add(id));
        break;
      case 'USER':
        ids.add(recipient.id);
        break;
      case 'POSITION':
        (sources.positionMembers.get(recipient.id) ?? []).forEach((id) => ids.add(id));
        break;
      case 'GROUP':
        (sources.groupMembers.get(recipient.id) ?? []).forEach((id) => ids.add(id));
        break;
    }
  }
  return [...ids].sort();
}

/** The ids a block names for positions and groups (to read their members in one query each). */
export function namedIds(recipients: readonly BlockRecipient[], kind: 'POSITION' | 'GROUP'): string[] {
  return [...new Set(recipients.flatMap((recipient) => (recipient.kind === kind ? [recipient.id] : [])))];
}
