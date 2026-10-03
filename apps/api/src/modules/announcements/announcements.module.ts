import { Module } from '@nestjs/common';
import { AnnouncementsService } from './application/announcements.service.js';
import { ActiveAnnouncementRepository } from './data/active-announcement.repository.js';
import { AnnouncementsController } from './http/announcements.controller.js';

/** What members see of the platform's announcements: the ones in force right now. */
@Module({ controllers: [AnnouncementsController], providers: [ActiveAnnouncementRepository, AnnouncementsService] })
export class AnnouncementsModule {}
