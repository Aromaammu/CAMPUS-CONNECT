import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { DEFAULT_TEMPLATE, NOTIFICATION_TYPES, fillTemplate } from '@cc/shared';
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
 * One place that tells people things: in-app notification centre, email and SMS (with the wording
 * from Settings → Message wording), plus browser push and live pop-ups attached through hooks.
 */
@Injectable()
export class NotifyService {
  private log = new Logger('Notify');
  private hooks: Hook[] = [];
  private templates: { at: number; map: Map<string, { subject: string | null; body: string; smsBody: string | null; smsTemplateId: string | null }> } | null = null;
  constructor(private prisma: PrismaService, private outbox: OutboxService) {}

  addHook(h: Hook) { this.hooks.push(h); }

  clearTemplateCache() { this.templates = null; }

  private async template(type: string) {
    if (!this.templates || Date.now() - this.templates.at > 30_000) {
      const rows = await this.prisma.messageTemplate.findMany();
      this.templates = { at: Date.now(), map: new Map(rows.map((r) => [r.key, r])) };
    }
    return this.templates.map.get(type) ?? null;
  }

  async send(userId: string, input: NotifyInput) {
    return this.sendMany([userId], input);
  }

  async sendMany(userIds: string[], input: NotifyInput) {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (!ids.length) return;
    const users = await this.prisma.user.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, include: { notificationPrefs: { where: { type: input.type } } } });
    if (!users.length) return;
    await this.prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null })) });
    const essential = input.essential ?? (NOTIFICATION_TYPES as Record<string, { essential: boolean }>)[input.type]?.essential ?? false;
    const t = input.email || input.sms ? await this.template(input.type) : null;
    for (const u of users) {
      const pref = u.notificationPrefs[0];
      const key = input.dedupeKey ? `${input.dedupeKey}:${u.id}` : undefined;
      const vars = { name: u.name, title: input.title, body: input.body ?? '', link: input.link ? `${process.env.APP_URL ?? ''}${input.link}` : '' };
      if (input.email && (essential || pref?.email !== false)) {
        await this.outbox.email(u.email, fillTemplate(t?.subject || DEFAULT_TEMPLATE.subject, vars), fillTemplate(t?.body || DEFAULT_TEMPLATE.body, vars), { template: input.type, dedupeKey: key && `${key}:e` });
      }
      if (input.sms) {
        await this.outbox.sms(u.mobile, fillTemplate(t?.smsBody || DEFAULT_TEMPLATE.smsBody, { ...vars, link: '' }).slice(0, 300), { template: input.type, dedupeKey: key && `${key}:s`, dltTemplateId: t?.smsTemplateId ?? undefined });
      }
    }
    for (const h of this.hooks) {
      try { await h(users.filter((u) => essential || u.notificationPrefs[0]?.push !== false).map((u) => u.id), input); } catch (e) { this.log.warn(`hook failed: ${(e as Error).message}`); }
    }
  }
}

@Global()
@Module({ providers: [NotifyService], exports: [NotifyService] })
export class NotifyModule {}
