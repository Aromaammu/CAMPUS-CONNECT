import { Body, Controller, Delete, Get, Global, HttpCode, Injectable, Logger, Module, OnModuleInit, Param, Post, Put, Query } from '@nestjs/common';
import { formatTime } from '@cc/shared';
import { JobsService } from '../../common/jobs.service';
import { NOTIFICATION_KEYS, NOTIFICATION_TYPES, SessionUser, notificationPrefsSchema, pushSubscriptionSchema, templateSchema } from '@cc/shared';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import webpush from 'web-push';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, Public, RequirePerm } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { config } from '../../config';
import { OutboxService } from '../outbox/outbox.service';
import { NotifyService } from './notify.service';

/** Browser push (web-push, VAPID). In development pushes are recorded in the test mailbox instead. */
@Injectable()
export class PushService implements OnModuleInit {
  private log = new Logger('Push');
  publicKey = '';
  constructor(private prisma: PrismaService, private notify: NotifyService, private outbox: OutboxService) {}

  onModuleInit() {
    let keys = config.vapidPublic && config.vapidPrivate ? { publicKey: config.vapidPublic, privateKey: config.vapidPrivate } : null;
    if (!keys) {
      // Development: one key pair kept on this computer so browser subscriptions survive restarts.
      const file = join(__dirname, '..', '..', '..', '..', '..', '.data', 'vapid.json');
      if (existsSync(file)) keys = JSON.parse(readFileSync(file, 'utf8'));
      else { keys = webpush.generateVAPIDKeys(); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(keys)); }
    }
    this.publicKey = keys!.publicKey;
    webpush.setVapidDetails(config.vapidSubject, keys!.publicKey, keys!.privateKey);
    this.notify.addHook((userIds, input) => this.send(userIds, { title: input.title, body: input.body ?? '', link: input.link ?? '/notifications', type: input.type }));
  }

  /** Sends to every browser the people turned push on in. */
  async send(userIds: string[], p: { title: string; body: string; link: string; type: string }) {
    if (!userIds.length) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId: { in: userIds } }, include: { user: { select: { email: true, mobile: true } } } });
    if (config.pushMode === 'capture') {
      const seen = new Set<string>();
      for (const s of subs) if (!seen.has(s.userId)) { seen.add(s.userId); await this.outbox.capturePush(s.user.email ?? s.user.mobile ?? s.userId, p.title, p.body, p.type); }
      return;
    }
    for (const s of subs) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 3600 });
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else this.log.warn(`push failed: ${(e as Error).message}`);
      }
    }
  }

  /** Push without an in-app notification row (new chat messages: the unread count already shows them). */
  async toUsersWithPref(userIds: string[], p: { title: string; body: string; link: string; type: string }) {
    const off = await this.prisma.notificationPref.findMany({ where: { userId: { in: userIds }, type: p.type, push: false }, select: { userId: true } });
    const blocked = new Set(off.map((o) => o.userId));
    await this.send(userIds.filter((u) => !blocked.has(u)), p);
  }
}

/** C2 Notification centre, preferences, push subscriptions; message wording for Settings admins. */
@Controller()
export class NotificationsController {
  constructor(private prisma: PrismaService, private push: PushService, private notify: NotifyService, private audit: AuditService) {}

  @Get('notifications')
  async list(@CurrentUser() user: SessionUser, @Query('page') page = '1', @Query('unread') unread?: string) {
    const take = 30;
    const p = Math.max(1, Number(page) || 1);
    const where = { userId: user.id, ...(unread === '1' ? { readAt: null } : {}) };
    const [total, rows, unreadCount] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip: (p - 1) * take }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { total, page: p, pageSize: take, unread: unreadCount, rows };
  }

  @Post('notifications/read')
  @HttpCode(200)
  async read(@CurrentUser() user: SessionUser, @Body(new Zod(z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }))) body: { ids?: string[]; all?: boolean }) {
    const { count } = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null, ...(body.all ? {} : { id: { in: body.ids ?? [] } }) }, data: { readAt: new Date() } });
    return { read: count };
  }

  @Get('notifications/prefs')
  async prefs(@CurrentUser() user: SessionUser) {
    const rows = await this.prisma.notificationPref.findMany({ where: { userId: user.id } });
    return NOTIFICATION_KEYS.filter((k) => user.kind !== 'STUDENT' || !['N14', 'N15', 'N19', 'MEETING'].includes(k)).map((type) => {
      const r = rows.find((x) => x.type === type);
      const t = NOTIFICATION_TYPES[type];
      return { type, label: t.label, channels: t.channels, essential: t.essential, email: t.essential ? true : (r?.email ?? true), push: t.essential ? true : (r?.push ?? true) };
    });
  }

  @Put('notifications/prefs')
  async savePrefs(@CurrentUser() user: SessionUser, @Body(new Zod(notificationPrefsSchema)) body: z.infer<typeof notificationPrefsSchema>) {
    for (const p of body.prefs) {
      const t = (NOTIFICATION_TYPES as Record<string, { essential: boolean }>)[p.type];
      if (!t || t.essential) continue; // security, fee and class-change messages always send
      await this.prisma.notificationPref.upsert({ where: { userId_type: { userId: user.id, type: p.type } }, create: { userId: user.id, type: p.type, email: p.email, push: p.push }, update: { email: p.email, push: p.push } });
    }
    return { ok: true };
  }

  @Public()
  @Get('notifications/push-key')
  key() {
    return { publicKey: this.push.publicKey };
  }

  @Post('notifications/push-subscriptions')
  async subscribe(@CurrentUser() user: SessionUser, @Body(new Zod(pushSubscriptionSchema)) body: z.infer<typeof pushSubscriptionSchema>) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: body.endpoint },
      create: { userId: user.id, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth },
      update: { userId: user.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
    });
    return { ok: true };
  }

  @Delete('notifications/push-subscriptions')
  async unsubscribe(@CurrentUser() user: SessionUser, @Query('endpoint') endpoint?: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId: user.id, ...(endpoint ? { endpoint } : {}) } });
    return { ok: true };
  }

  /** Settings → Message wording. */
  @Get('settings/templates')
  @RequirePerm('settings.manage')
  async templates() {
    const rows = await this.prisma.messageTemplate.findMany();
    return NOTIFICATION_KEYS.map((key) => ({ key, label: NOTIFICATION_TYPES[key].label, channels: NOTIFICATION_TYPES[key].channels, custom: rows.find((r) => r.key === key) ?? null }));
  }

  @Put('settings/templates/:key')
  @RequirePerm('settings.manage')
  async saveTemplate(@CurrentUser() user: SessionUser, @Param('key') key: string, @Body(new Zod(templateSchema)) body: z.infer<typeof templateSchema>) {
    if (!(NOTIFICATION_KEYS as string[]).includes(key)) return { ok: false };
    await this.prisma.messageTemplate.upsert({ where: { key }, create: { key, ...body }, update: body });
    this.notify.clearTemplateCache();
    await this.audit.record({ actorId: user.id, action: 'settings.template', entity: 'MessageTemplate', entityId: key, summary: `Changed the wording of "${NOTIFICATION_TYPES[key as keyof typeof NOTIFICATION_TYPES].label}"` });
    return { ok: true };
  }

  @Delete('settings/templates/:key')
  @RequirePerm('settings.manage')
  async resetTemplate(@CurrentUser() user: SessionUser, @Param('key') key: string) {
    await this.prisma.messageTemplate.deleteMany({ where: { key } });
    this.notify.clearTemplateCache();
    await this.audit.record({ actorId: user.id, action: 'settings.template', entity: 'MessageTemplate', entityId: key, summary: `Reset the wording of ${key} to the default` });
    return { ok: true };
  }
}

/** N3: "Class starts in 15 minutes" to the batch and its teacher, once per class. */
@Injectable()
export class ClassReminderJob implements OnModuleInit {
  constructor(private jobs: JobsService, private prisma: PrismaService, private notify: NotifyService) {}
  onModuleInit() { this.jobs.register('notify.classSoon', 60_000, () => this.run()); }
  async run(now = new Date()) {
    const soon = await this.prisma.session.findMany({
      where: { status: 'SCHEDULED', startsAt: { gt: new Date(now.getTime() + 9 * 60_000), lte: new Date(now.getTime() + 16 * 60_000) }, batch: { mode: { not: 'OFFLINE' }, status: { not: 'CANCELLED' } } },
      include: { batch: { include: { enrolments: { where: { status: 'ACTIVE' }, select: { student: { select: { userId: true } } } }, teachers: { select: { employee: { select: { userId: true } } } } } }, teacher: { select: { userId: true } } },
    });
    for (const s of soon) {
      await this.jobs.once(`n3:${s.id}`, async () => {
        const to = [...s.batch.enrolments.map((e) => e.student.userId), ...(s.teacher ? [s.teacher.userId] : s.batch.teachers.map((t) => t.employee.userId))];
        await this.notify.sendMany(to, { type: 'N3', title: `${s.batch.name}: class at ${formatTime(s.startsAt)}`, body: 'Starts in about 15 minutes.', link: `/live/${s.id}` });
      });
    }
  }
}

@Global()
@Module({ controllers: [NotificationsController], providers: [PushService, ClassReminderJob], exports: [PushService, ClassReminderJob] })
export class NotificationsModule {}
