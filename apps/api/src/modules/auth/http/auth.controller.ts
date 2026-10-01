import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  acceptInvitationRequestSchema,
  type AccessTokenResponse,
  type LoginRequest,
  type LoginResponse,
  loginRequestSchema,
  type MeResponse,
  type PasswordResetConfirm,
  passwordResetConfirmSchema,
  type PasswordResetRequest,
  passwordResetRequestSchema,
  type SelectTenantRequest,
  selectTenantRequestSchema,
  UnauthenticatedError,
} from '@procesabpm/shared';
import type { Request, Response } from 'express';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { Public } from '../../../common/auth/public.decorator.js';
import { RateLimit, RateLimitGuard } from '../../../common/auth/rate-limit.js';
import { BackgroundTasks } from '../../../common/background/background-tasks.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { InvitationService } from '../application/invitation.service.js';
import { LoginService } from '../application/login.service.js';
import { PasswordResetService } from '../application/password-reset.service.js';
import { ProfileService } from '../application/profile.service.js';
import { type ClientInfo, type OpenedSession, SessionService } from '../application/session.service.js';
import { TenantSelectionService } from '../application/tenant-selection.service.js';
import { RATE_LIMITS } from '../domain/auth-policy.js';
import { bearerToken } from './bearer-token.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from './refresh-cookie.js';

const USER_AGENT_MAX_LENGTH = 512;

function clientOf(request: Request): ClientInfo {
  return { ipAddress: request.ip ?? null, userAgent: request.header('user-agent')?.slice(0, USER_AGENT_MAX_LENGTH) ?? null };
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(LoginService) private readonly login: LoginService,
    @Inject(TenantSelectionService) private readonly tenantSelection: TenantSelectionService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordResetService) private readonly passwordReset: PasswordResetService,
    @Inject(InvitationService) private readonly invitations: InvitationService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(BackgroundTasks) private readonly background: BackgroundTasks,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.login)
  @UseGuards(RateLimitGuard)
  logIn(@Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest): Promise<LoginResponse> {
    return this.login.login(body);
  }

  /** Authenticated with the selection token returned by the login (`Authorization: Bearer`). */
  @Public()
  @Post('select-tenant')
  @HttpCode(HttpStatus.OK)
  async selectTenant(
    @Body(new ZodValidationPipe(selectTenantRequestSchema)) body: SelectTenantRequest,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenResponse> {
    const selectionToken = bearerToken(request.header('authorization'));
    if (selectionToken === undefined) throw new UnauthenticatedError();
    const session = await this.tenantSelection.select(selectionToken, body.tenantId, clientOf(request));
    return this.deliver(session, response);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<AccessTokenResponse> {
    try {
      return this.deliver(await this.sessions.refresh(readRefreshCookie(request), clientOf(request)), response);
    } catch (error) {
      // A suspended tenant (403) keeps the session: it works again when the tenant is reactivated.
      if (error instanceof UnauthenticatedError) clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.sessions.logout(readRefreshCookie(request));
    clearRefreshCookie(response);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(RATE_LIMITS.passwordReset)
  @UseGuards(RateLimitGuard)
  /** Answers at once and does the work afterwards, so the response time does not reveal whether the account exists. */
  requestPasswordReset(@Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequest): void {
    this.background.run('auth.password_reset_request', () => this.passwordReset.request(body.email));
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RateLimit(RATE_LIMITS.passwordResetConfirm)
  @UseGuards(RateLimitGuard)
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirm,
  ): Promise<void> {
    await this.passwordReset.confirm(body.token, body.newPassword);
  }

  @Public()
  @Post('invitations/accept')
  @HttpCode(HttpStatus.OK)
  @RateLimit(RATE_LIMITS.invitation)
  @UseGuards(RateLimitGuard)
  acceptInvitation(
    @Body(new ZodValidationPipe(acceptInvitationRequestSchema)) body: AcceptInvitationRequest,
  ): Promise<AcceptInvitationResponse> {
    return this.invitations.accept(body.token, body.password);
  }

  @Get('me')
  me(@CurrentPrincipal() principal: Principal): Promise<MeResponse> {
    return this.profiles.me(principal);
  }

  private deliver(session: OpenedSession, response: Response): AccessTokenResponse {
    setRefreshCookie(response, session.refreshToken, session.refreshExpiresAt);
    return { accessToken: session.accessToken.token, tokenType: 'Bearer', expiresIn: session.accessToken.expiresIn };
  }
}
