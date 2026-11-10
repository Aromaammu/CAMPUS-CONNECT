import { Global, Injectable, Logger, Module } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { config } from '../../config';
import { PrismaService } from '../../common/prisma.service';

/**
 * Every email and SMS goes through here and is recorded in OutboundMessage.
 * Development and tests: "capture" mode — nothing leaves the machine; the Test Mailbox screen shows them.
 */
@Injectable()
export class OutboxService {
  private log = new Logger('Outbox');
  private transport = config.mailMode === 'smtp' && config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

  constructor(private prisma: PrismaService) {}

  async email(to: string | null | undefined, subject: string, body: string, opts: { dedupeKey?: string; template?: string } = {}) {
    if (!to) return null;
    return this.deliver('EMAIL', to, subject, body, opts);
  }

  async sms(to: string | null | undefined, body: string, opts: { dedupeKey?: string; template?: string; dltTemplateId?: string } = {}) {
    if (!to) return null;
    return this.deliver('SMS', to, null, body, opts);
  }

  /** Browser push is recorded here too in development (the real push is sent by PushService). */
  async capturePush(to: string, title: string, body: string, type: string) {
    return this.prisma.outboundMessage.create({ data: { channel: 'PUSH', to, subject: title, body, template: type, status: 'CAPTURED' } });
  }

  private async deliver(channel: 'EMAIL' | 'SMS', to: string, subject: string | null, body: string, opts: { dedupeKey?: string; template?: string; dltTemplateId?: string }) {
    if (opts.dedupeKey) {
      const exists = await this.prisma.outboundMessage.findUnique({ where: { dedupeKey: opts.dedupeKey } });
      if (exists) return exists; // never send the same message twice
    }
    const capture = channel === 'EMAIL' ? !this.transport : config.smsMode !== 'live';
    const row = await this.prisma.outboundMessage.create({
      data: { channel, to, subject, body, template: opts.template, dedupeKey: opts.dedupeKey, status: capture ? 'CAPTURED' : 'QUEUED' },
    });
    if (capture) return row;
    try {
      if (channel === 'EMAIL' && this.transport) {
        await this.transport.sendMail({ from: config.mailFrom, to, subject: subject ?? '', text: body });
      } else {
        await this.sendSms(to, body, opts.dltTemplateId);
      }
      return this.prisma.outboundMessage.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
    } catch (e) {
      this.log.warn(`${channel} to ${to} failed: ${(e as Error).message}`);
      return this.prisma.outboundMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: (e as Error).message } });
    }
  }

  /** Our existing SMS gateway (same as other projects): JSON POST with a bearer token and the DLT template id. */
  private async sendSms(to: string, body: string, dltTemplateId?: string) {
    if (!config.smsApiUrl || !config.smsAccessToken) throw new Error('SMS gateway not connected (set SMS_API_URL and SMS_ACCESS_TOKEN)');
    const res = await fetch(config.smsApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.smsAccessToken}` },
      body: JSON.stringify({ to: to.replace(/\D/g, '').slice(-10), message: body, sender: config.smsSender, templateId: dltTemplateId }),
    });
    if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
  }
}

@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
