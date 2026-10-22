import { type AcceptInvitationRequest, type AcceptInvitationResponse, acceptInvitationResponseSchema, type PasswordResetConfirm } from '@procesabpm/shared';
import type { HttpClient } from '@/shared/api';

/** Always answered the same way (202), whether or not the e-mail belongs to someone: it reveals nothing. */
export function requestPasswordReset(transport: HttpClient, email: string): Promise<void> {
  return transport.request('/auth/password-reset/request', { method: 'POST', body: { email } });
}

export function confirmPasswordReset(transport: HttpClient, body: PasswordResetConfirm): Promise<void> {
  return transport.request('/auth/password-reset/confirm', { method: 'POST', body });
}

/** A new user sends the password they choose; someone who already has an account sends none. */
export function acceptInvitation(transport: HttpClient, body: AcceptInvitationRequest): Promise<AcceptInvitationResponse> {
  return transport.request('/auth/invitations/accept', { method: 'POST', body, schema: acceptInvitationResponseSchema });
}
