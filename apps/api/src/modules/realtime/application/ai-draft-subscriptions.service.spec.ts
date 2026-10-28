import { describe, expect, it, vi } from 'vitest';
import type { Principal } from '../../../common/auth/principal.js';
import type { AbilityService } from '../../authorization/application/ability.service.js';
import { RoomNames } from '../domain/room-names.js';
import { AiDraftSubscriptionsService, MAX_AI_DRAFT_SUBSCRIPTIONS } from './ai-draft-subscriptions.service.js';
import { DbWorkLimiter } from './db-work-limiter.js';
import type { SessionGate } from './session-gate.js';
import { type RealtimeSocket, SocketSession } from './socket-session.js';

const principal: Principal = { userId: 'u', tenantId: 't', sessionId: 's', roleId: 'r', roleActive: true, roleIsAdmin: false, isOwner: false, permissionsVersion: 1, membership: { departmentId: null, siteId: null, positionId: null }, tenantMode: 'ACTIVE' };

function setUp(options: { canEdit?: boolean; verified?: boolean } = {}) {
  const joined: string[] = [];
  const left: string[] = [];
  const socket = { id: 'socket', data: { session: new SocketSession(principal, new Date(Date.now() + 60_000), 0, '127.0.0.1') }, join: (room: string) => joined.push(room), leave: (room: string) => left.push(room) } as unknown as RealtimeSocket;
  const session = socket.data.session!;
  const gate = { verify: () => Promise.resolve(options.verified === false ? undefined : session.principal) } as unknown as SessionGate;
  const can = vi.fn((action: string, subject: string) => options.canEdit !== false && action === 'update' && subject === 'Workflow');
  const abilities = { forPrincipal: () => Promise.resolve({ can }) } as unknown as AbilityService;
  const service = new AiDraftSubscriptionsService(gate, abilities, new DbWorkLimiter({ REALTIME_DB_CONCURRENCY: 4 }));
  return { service, socket, session, joined, left };
}

describe('AiDraftSubscriptionsService', () => {
  it('joins the room of the draft in the member’s own tenant when they may edit workflows', async () => {
    const { service, socket, session, joined } = setUp();
    expect((await service.subscribe(socket, 'v1')).ack).toEqual({ ok: true });
    expect(joined).toEqual([RoomNames.aiDraft('t', 'v1')]);
    expect([...session.aiDrafts]).toEqual(['v1']);
  });

  it('answers NOT_FOUND to a member who may not edit workflows, and AUTH_REQUIRED or unavailable to an unverified session', async () => {
    const reader = setUp({ canEdit: false });
    expect((await reader.service.subscribe(reader.socket, 'v1')).ack).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(reader.joined).toEqual([]);
    const unverified = setUp({ verified: false });
    expect((await unverified.service.subscribe(unverified.socket, 'v1')).ack).toEqual({ ok: false, code: 'TEMPORARILY_UNAVAILABLE' });
  });

  it(`follows at most ${MAX_AI_DRAFT_SUBSCRIPTIONS} drafts per socket; unsubscribe and drop leave the room`, async () => {
    const { service, socket, session, left } = setUp();
    for (let index = 0; index < MAX_AI_DRAFT_SUBSCRIPTIONS; index += 1) await service.subscribe(socket, `v${index}`);
    expect((await service.subscribe(socket, 'extra')).ack).toEqual({ ok: false, code: 'TOO_MANY_SUBSCRIPTIONS' });
    expect((await service.subscribe(socket, 'v0')).ack).toEqual({ ok: true });
    await service.unsubscribe(socket, 'v0');
    service.drop(socket, 'v1');
    service.drop(socket, 'unknown');
    expect(left).toEqual([RoomNames.aiDraft('t', 'v0'), RoomNames.aiDraft('t', 'v1')]);
    expect(session.aiDrafts.size).toBe(MAX_AI_DRAFT_SUBSCRIPTIONS - 2);
  });
});
