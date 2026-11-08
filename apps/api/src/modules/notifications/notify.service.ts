import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import { OutboxService } from '../outbox/outbox.service';

export interface NotifyInput {
  /** PRD §15 code, e.g. "N5" */
  type: string;
  title: string;
  body?: string;
  link?: string;
  email?: boolean;
  sms?: boolean;
  /** Security, fee and class-change messages ignore personal preferences (PRD §15). */
  essential?: boolean;
  /** Same key → sent once only. */
  dedupeKey?: string;
}

type Hook = (userIds: string[], input: NotifyInput) => Promise<void> | void;

/**
 * One place that tells people things: in-app notification centre, email, SMS
 * (and browser push + live updates, attached in Phase 8 through hooks).
 */
@Injectable()
export class NotifyService {
  private log = new Logger('Notify');
  private hooks: Hook[] = [];
  constructor(private prisma: PrismaService, private outbox: OutboxService) {}

  addHook(h: Hook) { this.hooks.push(h); }

  async send(userId: string, input: NotifyInput) {
    return this.sendMany([userId], input);
  }

  async sendMany(userIds: string[], input: NotifyInput) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, include: { notificationPrefs: { where: { type: input.type } } } });
    if (!users.length) return;
    await this.prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null })) });
    for (const u of users) {
      const pref = u.notificationPrefs[0];
      const key = input.dedupeKey ? `${input.dedupeKey}:${u.id}` : undefined;
      if (input.email && (input.essential || pref?.email !== false)) {
        await this.outbox.email(u.email, input.title, `Hello ${u.name},\n\n${input.title}${input.body ? `\n${input.body}` : ''}${input.link ? `\n\nOpen: ${process.env.APP_URL ?? ''}${input.link}` : ''}`, { template: input.type, dedupeKey: key && `${key}:e` });
      }
      if (input.sms) await this.outbox.sms(u.mobile, `${input.title}${input.body ? `: ${input.body}` : ''}`.slice(0, 300), { template: input.type, dedupeKey: key && `${key}:s` });
    }
    for (const h of this.hooks) {
      try { await h(users.filter((u) => input.essential || u.notificationPrefs[0]?.push !== false).map((u) => u.id), input); } catch (e) { this.log.warn(`hook failed: ${(e as Error).message}`); }
    }
  }
}

@Global()
@Module({ providers: [NotifyService], exports: [NotifyService] })
export class NotifyModule {}
