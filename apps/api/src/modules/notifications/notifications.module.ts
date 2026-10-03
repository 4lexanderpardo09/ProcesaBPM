import { Module } from '@nestjs/common';
import { NotificationsService } from './application/notifications.service.js';
import { NotificationRepository } from './data/notification.repository.js';
import { NotificationsController } from './http/notifications.controller.js';

/** What people see of their notifications: the list, the unread counter, marking as read and their preferences. */
@Module({ controllers: [NotificationsController], providers: [NotificationRepository, NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}
