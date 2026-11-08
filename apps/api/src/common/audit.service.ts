import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from './prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string; // e.g. "student.create"
  entity: string; // e.g. "Student"
  entityId?: string | null;
  branchId?: string | null;
  summary?: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

const SECRET_KEYS = /password|token|hash|secret|code/i;
function scrub(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v, (k, val) => (SECRET_KEYS.test(k) && typeof val === 'string' ? '[hidden]' : val)));
}

/** Append-only audit log (PRD §17). Pass the transaction client so the entry commits with the change. */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(e: AuditEntry, tx: Tx = this.prisma) {
    await tx.auditLog.create({
      data: {
        actorId: e.actorId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        branchId: e.branchId ?? null,
        summary: e.summary,
        before: scrub(e.before),
        after: scrub(e.after),
        ip: e.ip ?? null,
      },
    });
  }
}

@Global()
@Module({ providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
