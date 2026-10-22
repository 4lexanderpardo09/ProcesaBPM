import {
  accessTokenResponseSchema,
  type AccessTokenResponse,
  type LoginRequest,
  loginResponseSchema,
  type LoginResponse,
  type MfaCode,
  mfaEnrollmentConfirmedResponseSchema,
  type MfaEnrollmentConfirmedResponse,
  mfaEnrollmentSchema,
  type MfaEnrollment,
  type MfaFactor,
  mfaLoginResponseSchema,
  type MfaLoginResponse,
} from '@procesabpm/shared';
import type { HttpClient } from '@/shared/api';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export function logIn(transport: HttpClient, body: LoginRequest): Promise<LoginResponse> {
  return transport.request('/auth/login', { method: 'POST', body, schema: loginResponseSchema });
}

export function verifyMfa(transport: HttpClient, challengeToken: string, body: MfaFactor): Promise<MfaLoginResponse> {
  return transport.request('/auth/login/mfa', { method: 'POST', body, headers: bearer(challengeToken), schema: mfaLoginResponseSchema });
}

/** Each call replaces the pending secret: call it once per challenge, from an event handler (never an effect). */
export function beginMfaEnrollment(transport: HttpClient, challengeToken: string): Promise<MfaEnrollment> {
  return transport.request('/auth/login/mfa/enrollment', { method: 'POST', headers: bearer(challengeToken), schema: mfaEnrollmentSchema });
}

export function confirmMfaEnrollment(transport: HttpClient, challengeToken: string, body: MfaCode): Promise<MfaEnrollmentConfirmedResponse> {
  return transport.request('/auth/login/mfa/enrollment/confirm', {
    method: 'POST',
    body,
    headers: bearer(challengeToken),
    schema: mfaEnrollmentConfirmedResponseSchema,
  });
}

/** Opens the session; the refresh cookie arrives with the answer. Only the session manager calls it (under the cookie lock). */
export function selectTenant(transport: HttpClient, selectionToken: string, tenantId: string): Promise<AccessTokenResponse> {
  return transport.request('/auth/select-tenant', { method: 'POST', body: { tenantId }, headers: bearer(selectionToken), schema: accessTokenResponseSchema });
}

/** Moves the session to another organization of the same person, with the refresh cookie (no new sign-in). */
export function switchTenant(transport: HttpClient, tenantId: string): Promise<AccessTokenResponse> {
  return transport.request('/auth/switch-tenant', { method: 'POST', body: { tenantId }, schema: accessTokenResponseSchema });
}
