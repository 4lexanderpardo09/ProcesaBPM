import { Module } from '@nestjs/common';
import { AuditTrailModule } from '../audit/audit-trail.module.js';
import { EmailPoliciesService } from './application/email-policies.service.js';
import { NotificationsService } from './application/notifications.service.js';
import { EmailPolicyRepository } from './data/email-policy.repository.js';
import { NotificationRepository } from './data/notification.repository.js';
import { EmailPoliciesController } from './http/email-policies.controller.js';
import { NotificationsController } from './http/notifications.controller.js';

/** What people see of their notifications (the list, the unread counter, marking as read and their preferences), and the organization's e-mail policy. */
@Module({
  imports: [AuditTrailModule],
  controllers: [NotificationsController, EmailPoliciesController],
  providers: [NotificationRepository, EmailPolicyRepository, NotificationsService, EmailPoliciesService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
