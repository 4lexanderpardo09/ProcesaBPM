import {
  backupCodesResponseSchema,
  type ChangePasswordRequest,
  type DisableMfaRequest,
  meResponseSchema,
  mfaEnrollmentSchema,
  mfaStatusResponseSchema,
  signatureResponseSchema,
  type UpdateProfileRequest,
} from '@procesabpm/shared';
import { queryOptions } from '@tanstack/react-query';
import type { HttpClient } from '@/shared/api';

export const profileQueryKeys = {
  mfa: ['profile', 'mfa'] as const,
  signature: ['profile', 'signature'] as const,
};

/** Name and time zone; the e-mail is not changed here. */
export function updateProfile(client: HttpClient, request: UpdateProfileRequest) {
  return client.request('/auth/me', { method: 'PATCH', body: request, schema: meResponseSchema });
}

export function changePassword(client: HttpClient, request: ChangePasswordRequest) {
  return client.request('/auth/password', { method: 'POST', body: request });
}

export function mfaStatusQueryOptions(client: HttpClient) {
  return queryOptions({ queryKey: profileQueryKeys.mfa, queryFn: ({ signal }) => client.request('/auth/mfa', { schema: mfaStatusResponseSchema, signal }) });
}

/** A new secret to scan; nothing changes until a code from the app confirms it. */
export function beginMfaEnrollment(client: HttpClient) {
  return client.request('/auth/mfa/enrollment', { method: 'POST', schema: mfaEnrollmentSchema });
}

/** Also asks for the password: a stolen session alone cannot take over the second factor. */
export function confirmMfaEnrollment(client: HttpClient, code: string, currentPassword: string) {
  return client.request('/auth/mfa/enrollment/confirm', { method: 'POST', body: { code, currentPassword }, schema: backupCodesResponseSchema });
}

export function disableMfa(client: HttpClient, request: DisableMfaRequest) {
  return client.request('/auth/mfa/disable', { method: 'POST', body: request });
}

/** New backup codes replace the old ones, which stop working. */
export function regenerateBackupCodes(client: HttpClient, code: string) {
  return client.request('/auth/mfa/backup-codes', { method: 'POST', body: { code }, schema: backupCodesResponseSchema });
}

/** A short-lived link to the person's signature image, or null when there is none. */
export function signatureQueryOptions(client: HttpClient) {
  return queryOptions({
    queryKey: profileQueryKeys.signature,
    queryFn: ({ signal }) => client.request('/auth/me/signature', { schema: signatureResponseSchema.nullable(), signal }),
  });
}

/** Points the signature at an image already uploaded and confirmed. */
export function setSignature(client: HttpClient, fileId: string) {
  return client.request('/auth/me/signature', { method: 'PUT', body: { fileId } });
}

export function clearSignature(client: HttpClient) {
  return client.request('/auth/me/signature', { method: 'DELETE' });
}
