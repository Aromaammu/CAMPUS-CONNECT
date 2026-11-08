import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './common/prisma.service';
import { SettingsModule } from './common/settings.service';
import { AuditModule } from './common/audit.service';
import { AuthGuard, SessionUserService } from './common/auth';
import { AllExceptionsFilter } from './common/http';
import { CommonModule } from './common/common.module';
import { OutboxModule } from './modules/outbox/outbox.service';
import { MailboxModule } from './modules/outbox/mailbox.controller';
import { AuthModule } from './modules/auth/auth.controller';
import { FEATURE_MODULES } from './modules';

@Module({
  imports: [PrismaModule, SettingsModule, AuditModule, CommonModule, OutboxModule, MailboxModule, AuthModule, ...FEATURE_MODULES],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}

export { SessionUserService };
