import { Injectable } from '@nestjs/common';
import { PrismaService, Tx } from './prisma.service';
import { SettingsService } from './settings.service';

/**
 * Running numbers that never repeat or skip (PRD §5.3, §5.4, §11.2).
 * The counter row is incremented inside the caller's transaction, so a rolled-back
 * transaction does not consume a number.
 */
@Injectable()
export class IdService {
  constructor(private prisma: PrismaService, private settings: SettingsService) {}

  async next(tx: Tx, branchId: string, kind: 'STU' | 'EMP' | 'RCPT' | 'TKT', year: number): Promise<number> {
    const rows = await tx.$queryRaw<{ last: number }[]>`
      INSERT INTO "IdCounter" ("branchId", "kind", "year", "last") VALUES (${branchId}, ${kind}, ${year}, 1)
      ON CONFLICT ("branchId", "kind", "year") DO UPDATE SET "last" = "IdCounter"."last" + 1
      RETURNING "last"`;
    return Number(rows[0].last);
  }

  /** STU-KOC01-26-0001 */
  async studentCode(tx: Tx, branchId: string, branchCode: string) {
    const year = istYear();
    const n = await this.next(tx, branchId, 'STU', year);
    const prefix = await this.settings.get('ids.studentPrefix');
    return `${prefix}-${branchCode}-${String(year).slice(2)}-${String(n).padStart(4, '0')}`;
  }

  /** EMP-KOC01-0001 */
  async employeeCode(tx: Tx, branchId: string, branchCode: string) {
    const n = await this.next(tx, branchId, 'EMP', 0);
    const prefix = await this.settings.get('ids.employeePrefix');
    return `${prefix}-${branchCode}-${String(n).padStart(4, '0')}`;
  }

  /** RCPT/KOC01/2026/00001 */
  async receiptNo(tx: Tx, branchId: string, branchCode: string) {
    const year = istYear();
    const n = await this.next(tx, branchId, 'RCPT', year);
    const prefix = await this.settings.get('ids.receiptPrefix');
    return `${prefix}/${branchCode}/${year}/${String(n).padStart(5, '0')}`;
  }

  /** TKT-KOC01-000001 */
  async ticketNo(tx: Tx, branchId: string, branchCode: string) {
    const n = await this.next(tx, branchId, 'TKT', 0);
    return `TKT-${branchCode}-${String(n).padStart(6, '0')}`;
  }
}

export function istYear(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(d));
}
