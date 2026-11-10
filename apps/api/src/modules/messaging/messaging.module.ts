import { Module } from '@nestjs/common';
import { MessagingController } from './messaging.controller';
import { AnnouncementsController } from './announcements.controller';
import { MessagingService } from './messaging.service';

@Module({ controllers: [MessagingController, AnnouncementsController], providers: [MessagingService], exports: [MessagingService] })
export class MessagingModule {}
