import { decodeIdentity } from '@/shared/session/access-token';

export interface FakeProfileOptions {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly tenantMode?: 'ACTIVE' | 'DELETION_PENDING';
}

/** A `GET /auth/me` answer whose role names the organization of the bearer token, to tell organizations apart in tests. */
export function fakeProfile(authorization: string | undefined, { firstName = 'Ana', lastName = 'Torres', tenantMode = 'ACTIVE' }: FakeProfileOptions = {}) {
  const tenantId = decodeIdentity(authorization?.replace('Bearer ', '') ?? '')?.tenantId ?? 'unknown';
  return {
    user: { id: '018f0000-0000-7000-8000-000000000001', email: 'ana@example.com', firstName, lastName, locale: 'es-CO', timeZone: null, mfaEnabled: false, emailVerifiedAt: null },
    membership: {
      tenantId: '018f0000-0000-7000-8000-000000000002',
      status: 'ACTIVE',
      isOwner: false,
      role: { id: '018f0000-0000-7000-8000-000000000003', name: `Rol ${tenantId}`, isAdmin: false },
      companies: [],
      signatureFileId: null,
    },
    tenantMode,
  };
}
