import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  type ListNotificationsQuery,
  listNotificationsQuerySchema,
  type MarkedReadResponse,
  type NotificationPreferenceRequest,
  type NotificationPreferenceResponse,
  notificationPreferenceRequestSchema,
  type NotificationResponse,
  type NotificationTypeValue,
  notificationTypeSchema,
  type Page,
  type UnreadCountResponse,
} from '@procesabpm/shared';
import { CurrentPrincipal, type Principal } from '../../../common/auth/principal.js';
import { AuthenticatedOnly } from '../../../common/auth/route-access.js';
import { ZodValidationPipe } from '../../../common/http/zod-validation.pipe.js';
import { NotificationsService } from '../application/notifications.service.js';

/** Everyone reads and manages their own notifications: no catalog permission applies, only the caller's identity. */
@AuthenticatedOnly()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentPrincipal() who: Principal, @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery): Promise<Page<NotificationResponse>> {
    return this.notifications.list(who, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentPrincipal() who: Principal): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(who);
  }

  @Get('preferences')
  preferences(@CurrentPrincipal() who: Principal): Promise<NotificationPreferenceResponse[]> {
    return this.notifications.preferences(who);
  }

  @Put('preferences/:type')
  savePreference(
    @CurrentPrincipal() who: Principal,
    @Param('type', new ZodValidationPipe(notificationTypeSchema)) type: NotificationTypeValue,
    @Body(new ZodValidationPipe(notificationPreferenceRequestSchema)) body: NotificationPreferenceRequest,
  ): Promise<NotificationPreferenceResponse> {
    return this.notifications.savePreference(who, type, body);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentPrincipal() who: Principal): Promise<MarkedReadResponse> {
    return this.notifications.markAllRead(who);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  markRead(@CurrentPrincipal() who: Principal, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.notifications.markRead(who, id);
  }
}
