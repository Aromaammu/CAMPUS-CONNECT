import { BadRequestException, Injectable } from '@nestjs/common';
import { UserKind } from '@prisma/client';
import ExcelJS from 'exceljs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService, Tx } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { OutboxService } from '../outbox/outbox.service';
import { config } from '../../config';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class PeopleService {
  constructor(private prisma: PrismaService, private settings: SettingsService, private outbox: OutboxService) {}

  async assertUnique(tx: Tx, email: string | undefined, mobile: string, exceptUserId?: string) {
    const fieldErrors: Record<string, string> = {};
    if (email) {
      const e = await tx.user.findUnique({ where: { email } });
      if (e && e.id !== exceptUserId) fieldErrors.email = 'This email is already used by another account';
    }
    const m = await tx.user.findUnique({ where: { mobile } });
    if (m && m.id !== exceptUserId) fieldErrors.mobile = 'This mobile number is already used by another account';
    if (Object.keys(fieldErrors).length) throw new BadRequestException({ message: Object.values(fieldErrors)[0], fieldErrors });
  }

  createUser(tx: Tx, data: { kind: UserKind; name: string; email?: string; mobile: string }) {
    return tx.user.create({ data: { kind: data.kind, name: data.name, email: data.email ?? null, mobile: data.mobile, mustChangePassword: true } });
  }

  /** N1: welcome email + SMS with a 7-day link to set a password. */
  async sendWelcome(userId: string, kind: 'welcome' | 'reset' = 'welcome') {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 7 * 86400000) } });
    const link = `${config.appUrl}/reset-password?token=${token}&welcome=1`;
    const brand = await this.settings.get('brand.name');
    const subject = kind === 'welcome' ? `Welcome to ${brand}` : `Set your ${brand} password`;
    const body = kind === 'welcome'
      ? `Hello ${user.name},\n\nYour ${brand} account is ready. Log in with ${user.email ?? user.mobile}.\nSet your password within 7 days using this link:\n${link}\n\nSee you in class!`
      : `Hello ${user.name},\n\nYour branch asked us to send you a link to set a new password (valid 7 days):\n${link}`;
    await this.outbox.email(user.email, subject, body, { template: 'N1' });
    await this.outbox.sms(user.mobile, `${brand}: your account is ready. Set your password: ${link}`, { template: 'N1' });
  }

  async revokeSessions(tx: Tx, userId: string) {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

/** Reads the first sheet of an uploaded .xlsx into objects keyed by our column keys. */
export async function readSheet(buffer: Buffer, columns: readonly { header: string; key: string }[]) {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('That file could not be read. Please upload the Excel template (.xlsx).');
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new BadRequestException('The file has no sheets');
  const headerRow = ws.getRow(1);
  const colIndex: Record<string, number> = {};
  headerRow.eachCell((cell, col) => {
    const text = String(cell.text ?? '').trim().toLowerCase();
    const match = columns.find((c) => c.header.toLowerCase() === text);
    if (match) colIndex[match.key] = col;
  });
  const missing = columns.filter((c) => !(c.key in colIndex)).map((c) => c.header);
  if (missing.length) throw new BadRequestException(`These columns are missing: ${missing.join(', ')}. Please use the template.`);
  const rows: { row: number; data: Record<string, unknown> }[] = [];
  ws.eachRow((r, n) => {
    if (n === 1) return;
    const data: Record<string, unknown> = {};
    let any = false;
    for (const c of columns) {
      const cell = r.getCell(colIndex[c.key]);
      const v = cell.value instanceof Date ? cell.value : cell.text?.trim();
      if (v !== '' && v !== undefined && v !== null) any = true;
      data[c.key] = v === '' ? undefined : v;
    }
    if (any) rows.push({ row: n, data });
  });
  if (rows.length > 2000) throw new BadRequestException('Upload at most 2,000 rows at a time');
  return rows;
}

export async function templateWorkbook(sheet: string, columns: readonly { header: string; required?: boolean }[], example: string[], notes: string[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheet);
  ws.columns = columns.map((c) => ({ header: c.header, width: Math.max(16, c.header.length + 4) }));
  ws.getRow(1).font = { bold: true };
  columns.forEach((c, i) => { if (c.required) ws.getRow(1).getCell(i + 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBEFD9' } }; });
  ws.addRow(example);
  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 100;
  notes.forEach((n) => help.addRow([n]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
