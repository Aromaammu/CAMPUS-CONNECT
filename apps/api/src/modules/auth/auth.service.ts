import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { mobileSchema } from '@cc/shared';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AuditService } from '../../common/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import { signAccessToken } from '../../common/auth';
import { config } from '../../config';

export const POLICY_VERSION = '2026-11';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface Tokens { access: string; refresh: string; refreshMaxAgeMs: number }
interface ClientInfo { ip: string | null; userAgent?: string }

export async function hashPassword(pw: string) {
  return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private settings: SettingsService,
    private audit: AuditService,
    private outbox: OutboxService,
  ) {}

  private async findByIdentifier(identifier: string) {
    const id = identifier.trim();
    if (id.includes('@')) return this.prisma.user.findUnique({ where: { email: id.toLowerCase() } });
    const m = mobileSchema.safeParse(id);
    return m.success ? this.prisma.user.findUnique({ where: { mobile: m.data } }) : null;
  }

  async login(identifier: string, password: string, client: ClientInfo): Promise<Tokens> {
    const user = await this.findByIdentifier(identifier);
    const generic = 'The email/mobile or password is not correct';
    if (!user || !user.passwordHash) {
      await argon2.hash('timing-equaliser').catch(() => null);
      throw new UnauthorizedException(generic);
    }
    if (user.status !== 'ACTIVE') throw new ForbiddenException('Your account is not active. Please contact your branch.');
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw new ForbiddenException(`Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
    }
    const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
    if (!ok) {
      const s = await this.settings.all();
      // Atomic increment so parallel guesses can't bypass the lockout.
      const updated = await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: { increment: 1 } } });
      if (updated.failedLogins >= s['auth.lockoutAttempts']) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + s['auth.lockoutMinutes'] * 60000) },
        });
        await this.audit.record({ actorId: user.id, action: 'auth.locked', entity: 'User', entityId: user.id, summary: 'Locked after repeated wrong passwords', ip: client.ip });
        throw new ForbiddenException(`Too many wrong passwords. Try again in ${s['auth.lockoutMinutes']} minutes.`);
      }
      throw new UnauthorizedException(generic);
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'auth.login', entity: 'User', entityId: user.id, summary: 'Logged in', ip: client.ip });
    return this.issue(user.id, client);
  }

  async issue(userId: string, client: ClientInfo): Promise<Tokens> {
    const idle = await this.settings.get('auth.sessionIdleMinutes');
    const refresh = randomBytes(48).toString('base64url');
    const maxAge = Math.min(idle * 60000, config.refreshMaxDays * 86400000);
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(refresh), expiresAt: new Date(Date.now() + maxAge), ip: client.ip, userAgent: client.userAgent?.slice(0, 300) },
    });
    return { access: signAccessToken(userId), refresh, refreshMaxAgeMs: maxAge };
  }

  async refresh(token: string | undefined, client: ClientInfo): Promise<Tokens> {
    if (!token) throw new UnauthorizedException('Please log in again');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    if (!row) throw new UnauthorizedException('Please log in again');
    if (row.revokedAt) {
      // A used token came back: possible theft. End every session for this user.
      await this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Please log in again');
    }
    if (row.expiresAt < new Date() || row.user.status !== 'ACTIVE') throw new UnauthorizedException('Your session has ended. Please log in again.');
    const next = await this.issue(row.userId, client);
    const claimed = await this.prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date(), replacedBy: sha256(next.refresh) } });
    if (claimed.count === 0) throw new UnauthorizedException('Please log in again');
    await this.prisma.user.update({ where: { id: row.userId }, data: { lastSeenAt: new Date() } });
    return next;
  }

  async logout(token: string | undefined) {
    if (!token) return;
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async changePassword(
    userId: string,
    input: { currentPassword?: string; newPassword: string; consent?: boolean; guardianConsent?: boolean },
    client: ClientInfo,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { student: true, consents: true } });
    if (!user.mustChangePassword) {
      if (!input.currentPassword || !user.passwordHash || !(await argon2.verify(user.passwordHash, input.currentPassword).catch(() => false))) {
        throw new BadRequestException({ message: 'Your current password is not correct', fieldErrors: { currentPassword: 'Your current password is not correct' } });
      }
    }
    if (user.passwordHash && (await argon2.verify(user.passwordHash, input.newPassword).catch(() => false))) {
      throw new BadRequestException({ message: 'Choose a password different from the current one', fieldErrors: { newPassword: 'Choose a password different from the current one' } });
    }
    const needsConsent = !user.consents.some((c) => c.policyVersion === POLICY_VERSION);
    if (needsConsent && !input.consent) {
      throw new BadRequestException({ message: 'Please accept the Privacy Policy and Terms', fieldErrors: { consent: 'Please accept the Privacy Policy and Terms' } });
    }
    const minor = user.student?.dob ? ageOn(user.student.dob, new Date()) < 18 : false;
    if (needsConsent && minor && !input.guardianConsent) {
      throw new BadRequestException({ message: 'A parent or guardian must agree for students under 18', fieldErrors: { guardianConsent: 'A parent or guardian must agree for students under 18' } });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false } });
      if (needsConsent) {
        await tx.consent.create({ data: { userId, policyVersion: POLICY_VERSION, guardianConsent: !!input.guardianConsent, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) } });
      }
      await this.audit.record({ actorId: userId, action: 'auth.password_changed', entity: 'User', entityId: userId, summary: 'Changed password', ip: client.ip }, tx);
    });
  }

  /** Consent only (users who already chose their password through a welcome link). */
  async giveConsent(userId: string, input: { consent?: boolean; guardianConsent?: boolean }, client: ClientInfo) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { student: true, consents: true } });
    if (user.consents.some((c) => c.policyVersion === POLICY_VERSION)) return;
    if (!input.consent) throw new BadRequestException({ message: 'Please accept the Privacy Policy and Terms', fieldErrors: { consent: 'Please accept the Privacy Policy and Terms' } });
    const minor = user.student?.dob ? ageOn(user.student.dob, new Date()) < 18 : false;
    if (minor && !input.guardianConsent) throw new BadRequestException({ message: 'A parent or guardian must agree for students under 18', fieldErrors: { guardianConsent: 'A parent or guardian must agree for students under 18' } });
    await this.prisma.consent.create({ data: { userId, policyVersion: POLICY_VERSION, guardianConsent: !!input.guardianConsent, ip: client.ip, userAgent: client.userAgent?.slice(0, 300) } });
    await this.audit.record({ actorId: userId, action: 'privacy.consent', entity: 'User', entityId: userId, summary: 'Accepted the Privacy Policy and Terms', ip: client.ip });
  }

  async forgot(identifier: string) {
    const user = await this.findByIdentifier(identifier);
    if (!user || user.status !== 'ACTIVE') return; // same response either way
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60000) } });
    const link = `${config.appUrl}/reset-password?token=${token}`;
    const brand = await this.settings.get('brand.name');
    if (user.email) {
      await this.outbox.email(user.email, `Reset your ${brand} password`, `Hello ${user.name},\n\nUse this link within 30 minutes to set a new password:\n${link}\n\nIf you did not ask for this, you can ignore this email.`, { template: 'N2' });
    } else if (user.mobile) {
      await this.outbox.sms(user.mobile, `${brand}: reset your password within 30 minutes: ${link}`, { template: 'N2' });
    }
  }

  async reset(token: string, newPassword: string, client: ClientInfo) {
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw new BadRequestException('This link has expired. Please ask for a new one.');
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordReset.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
      if (claimed.count === 0) throw new BadRequestException('This link has already been used.');
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null, mustChangePassword: false } });
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record({ actorId: row.userId, action: 'auth.password_reset', entity: 'User', entityId: row.userId, summary: 'Reset password with a link', ip: client.ip }, tx);
    });
  }

  async requestOtp(mobile: string) {
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    const recent = await this.prisma.otpCode.count({ where: { mobile, createdAt: { gt: new Date(Date.now() - 3600000) } } });
    if (recent >= 5) throw new BadRequestException('Too many codes requested. Please try again in an hour.');
    const last = await this.prisma.otpCode.findFirst({ where: { mobile }, orderBy: { createdAt: 'desc' } });
    if (last && Date.now() - last.createdAt.getTime() < 30000) throw new BadRequestException('Please wait 30 seconds before asking for another code.');
    if (!user || user.status !== 'ACTIVE') return; // same response either way
    const code = String(randomInt(0, 1000000)).padStart(6, '0');
    await this.prisma.otpCode.create({ data: { mobile, codeHash: sha256(`${mobile}:${code}`), expiresAt: new Date(Date.now() + 5 * 60000) } });
    const brand = await this.settings.get('brand.name');
    await this.outbox.sms(mobile, `${code} is your ${brand} login code. It expires in 5 minutes. Do not share it.`, { template: 'N2-OTP' });
  }

  async verifyOtp(mobile: string, code: string, client: ClientInfo): Promise<Tokens> {
    const row = await this.prisma.otpCode.findFirst({ where: { mobile, usedAt: null }, orderBy: { createdAt: 'desc' } });
    const bad = new UnauthorizedException('That code is not correct or has expired');
    if (!row || row.expiresAt < new Date() || row.attempts >= 5) throw bad;
    if (row.codeHash !== sha256(`${mobile}:${code}`)) {
      await this.prisma.otpCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      throw bad;
    }
    const claimed = await this.prisma.otpCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    const user = await this.prisma.user.findUnique({ where: { mobile } });
    if (claimed.count === 0 || !user || user.status !== 'ACTIVE') throw bad;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    await this.audit.record({ actorId: user.id, action: 'auth.login_otp', entity: 'User', entityId: user.id, summary: 'Logged in with an SMS code', ip: client.ip });
    return this.issue(user.id, client);
  }
}

export function ageOn(dob: Date, on: Date) {
  let age = on.getUTCFullYear() - dob.getUTCFullYear();
  const m = on.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}
