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

  async sms(to: string | null | undefined, body: string, opts: { dedupeKey?: string; template?: string } = {}) {
    if (!to) return null;
    return this.deliver('SMS', to, null, body, opts);
  }

  private async deliver(channel: 'EMAIL' | 'SMS', to: string, subject: string | null, body: string, opts: { dedupeKey?: string; template?: string }) {
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
        // Live SMS gateway is connected at launch (PRD D10); until then nothing is sent.
        throw new Error('SMS gateway not connected');
      }
      return this.prisma.outboundMessage.update({ where: { id: row.id }, data: { status: 'SENT', sentAt: new Date() } });
    } catch (e) {
      this.log.warn(`${channel} to ${to} failed: ${(e as Error).message}`);
      return this.prisma.outboundMessage.update({ where: { id: row.id }, data: { status: 'FAILED', error: (e as Error).message } });
    }
  }
}

@Global()
@Module({ providers: [OutboxService], exports: [OutboxService] })
export class OutboxModule {}
