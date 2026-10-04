import { type AnnouncementResponse, MaintenanceError } from '@procesabpm/shared';

/** A platform announcement that blocks signing in, as cached by `LoginBlockRegistry`. */
export interface LoginBlock {
  readonly id: string;
  readonly type: AnnouncementResponse['type'];
  readonly title: string;
  readonly body: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  /** Audience ALL; otherwise only `tenantIds` are blocked. */
  readonly allTenants: boolean;
  readonly tenantIds: readonly string[];
}

/**
 * Who asks. `SIGN_IN` is the sign-in itself, before any organization is chosen: only announcements for every
 * organization apply there, so a targeted announcement never shows to (or tells anything to) people outside it.
 */
export type BlockScope = 'SIGN_IN' | { readonly tenantId: string };

/** `Retry-After` is capped at one day: a longer window is re-checked by the client at least daily. */
export const MAX_RETRY_AFTER_SECONDS = 86_400;

const isInForce = (block: LoginBlock, now: Date): boolean => block.startsAt <= now && (block.endsAt === null || block.endsAt > now);

const reaches = (block: LoginBlock, scope: BlockScope): boolean =>
  block.allTenants || (scope !== 'SIGN_IN' && block.tenantIds.includes(scope.tenantId));

const endOf = (block: LoginBlock): number => block.endsAt?.getTime() ?? Number.POSITIVE_INFINITY;

/** The one that lasts longest goes first (no end is the longest): its end is when the caller can try again. */
const byLatestEnd = (a: LoginBlock, b: LoginBlock): number => endOf(b) - endOf(a) || a.id.localeCompare(b.id);

/** The announcement that blocks `scope` at `now`, if any. */
export function blockFor(blocks: readonly LoginBlock[], now: Date, scope: BlockScope): LoginBlock | undefined {
  return blocks.filter((block) => isInForce(block, now) && reaches(block, scope)).sort(byLatestEnd)[0];
}

/**
 * The public sign-in banner: the blocks for every organization in force now, newest first. Nothing that is not a sign-in
 * block (release notes, information for members) and nothing targeted ever becomes public.
 */
export function publicNoticesOf(blocks: readonly LoginBlock[], now: Date): AnnouncementResponse[] {
  return blocks
    .filter((block) => block.allTenants && isInForce(block, now))
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime() || b.id.localeCompare(a.id))
    .map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      body: block.body,
      startsAt: block.startsAt.toISOString(),
      endsAt: block.endsAt?.toISOString() ?? null,
      blocksLogin: true,
    }));
}

/** Seconds until the block ends (at least 1, at most a day); none when it has no end. */
export function retryAfterSeconds(block: LoginBlock, now: Date): number | undefined {
  if (block.endsAt === null) return undefined;
  const seconds = Math.ceil((block.endsAt.getTime() - now.getTime()) / 1000);
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, seconds));
}

export function maintenanceErrorFor(block: LoginBlock, now: Date): MaintenanceError {
  return new MaintenanceError(
    { announcementId: block.id, title: block.title, body: block.body, endsAt: block.endsAt?.toISOString() ?? null },
    retryAfterSeconds(block, now),
  );
}
