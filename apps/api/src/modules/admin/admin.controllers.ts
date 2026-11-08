import { BadRequestException, Body, Controller, Get, Module, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { SETTINGS_DEFAULTS, SessionUser, adminSchema, adminUpdateSchema } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, Kinds, RequirePerm } from '../../common/org-access';
import { Zod, paging } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { SettingsService } from '../../common/settings.service';
import { PeopleService } from '../people/people.service';

/** Super Admin creates Admins and decides which modules each controls (PRD §4.1). */
@Controller('admins')
@Kinds('SUPER_ADMIN')
export class AdminsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private people: PeopleService) {}

  @Get()
  async list() {
    const rows = await this.prisma.user.findMany({
      where: { kind: 'ADMIN' },
      select: { id: true, name: true, email: true, mobile: true, status: true, lastLoginAt: true, adminModules: { select: { module: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((r) => ({ ...r, modules: r.adminModules.map((m) => m.module) }));
  }

  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(adminSchema)) body: z.infer<typeof adminSchema>) {
    const u = await this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile);
      const created = await this.people.createUser(tx, { kind: 'ADMIN', name: body.name, email: body.email, mobile: body.mobile });
      await tx.adminModuleGrant.createMany({ data: body.modules.map((module) => ({ userId: created.id, module })) });
      await this.audit.record({ actorId: user.id, action: 'admin.create', entity: 'User', entityId: created.id, summary: `Created Admin ${body.name} with ${body.modules.join(', ')}`, after: body }, tx);
      return created;
    });
    await this.people.sendWelcome(u.id);
    return u;
  }

  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(adminUpdateSchema)) body: z.infer<typeof adminUpdateSchema>) {
    const before = await this.prisma.user.findFirst({ where: { id, kind: 'ADMIN' }, include: { adminModules: true } });
    if (!before) throw new NotFoundException('Admin not found');
    await this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile, id);
      await tx.user.update({ where: { id }, data: { name: body.name, email: body.email, mobile: body.mobile } });
      await tx.adminModuleGrant.deleteMany({ where: { userId: id } });
      await tx.adminModuleGrant.createMany({ data: body.modules.map((module) => ({ userId: id, module })) });
      await this.audit.record({
        actorId: user.id, action: 'admin.modules', entity: 'User', entityId: id,
        summary: `Changed ${body.name}'s modules to ${body.modules.join(', ')}`,
        before: { modules: before.adminModules.map((m) => m.module) }, after: { modules: body.modules },
      }, tx);
    });
    return { ok: true };
  }

  @Patch(':id/status')
  async setStatus(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }))) body: { status: 'ACTIVE' | 'INACTIVE' }) {
    const a = await this.prisma.user.findFirst({ where: { id, kind: 'ADMIN' } });
    if (!a) throw new NotFoundException('Admin not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { status: body.status } });
      if (body.status === 'INACTIVE') await this.people.revokeSessions(tx, id);
      await this.audit.record({ actorId: user.id, action: body.status === 'ACTIVE' ? 'admin.reactivate' : 'admin.deactivate', entity: 'User', entityId: id, summary: `${body.status === 'ACTIVE' ? 'Reactivated' : 'Deactivated'} Admin ${a.name}` }, tx);
    });
    return { ok: true };
  }

  @Post(':id/password-link')
  async passwordLink(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const a = await this.prisma.user.findFirst({ where: { id, kind: 'ADMIN' } });
    if (!a) throw new NotFoundException('Admin not found');
    await this.people.sendWelcome(id, 'reset');
    await this.audit.record({ actorId: user.id, action: 'admin.password_link', entity: 'User', entityId: id, summary: `Sent a set-password link to ${a.name}` });
    return { ok: true };
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private settings: SettingsService, private audit: AuditService) {}

  @RequirePerm('settings.manage')
  @Get()
  all() {
    return this.settings.all();
  }

  /** Read-only rule values every signed-in screen may need (thresholds, limits). */
  @Get('rules')
  async rules() {
    const s = await this.settings.all();
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(s)) if (!k.startsWith('privacy.') && !k.startsWith('org.')) out[k] = (s as Record<string, unknown>)[k];
    return out;
  }

  @RequirePerm('settings.manage')
  @Put()
  async update(@CurrentUser() user: SessionUser, @Body() body: Record<string, unknown>) {
    const before = await this.settings.all();
    const clean: Record<string, unknown> = {};
    const fieldErrors: Record<string, string> = {};
    for (const [k, v] of Object.entries(body ?? {})) {
      if (!(k in SETTINGS_DEFAULTS)) continue;
      const def = (SETTINGS_DEFAULTS as Record<string, unknown>)[k];
      if (typeof def === 'number') {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) fieldErrors[k] = 'Enter a number of 0 or more';
        else clean[k] = n;
      } else if (typeof def === 'boolean') clean[k] = v === true || v === 'true';
      else {
        const s = String(v ?? '').trim();
        if (!s) fieldErrors[k] = 'This cannot be empty';
        else if (k.endsWith('.primary') || k.endsWith('.accent')) { if (!/^#[0-9a-fA-F]{6}$/.test(s)) fieldErrors[k] = 'Use a colour like #0E3B47'; else clean[k] = s; }
        else clean[k] = s.slice(0, 300);
      }
    }
    if (Object.keys(fieldErrors).length) throw new BadRequestException({ message: Object.values(fieldErrors)[0], fieldErrors });
    await this.settings.set(clean as never, user.id);
    const changed = Object.keys(clean).filter((k) => (before as Record<string, unknown>)[k] !== clean[k]);
    if (changed.length) {
      await this.audit.record({
        actorId: user.id, action: 'settings.update', entity: 'Setting', summary: `Changed ${changed.length} setting${changed.length === 1 ? '' : 's'}: ${changed.join(', ')}`,
        before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, clean[k]])),
      });
    }
    return this.settings.all();
  }
}

@Controller('audit')
export class AuditController {
  constructor(private prisma: PrismaService) {}

  @RequirePerm('audit.view')
  @Get()
  async list(@Query() q: Record<string, string>) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(100, Number(q.pageSize) || 50);
    const where = {
      ...(q.branchId ? { branchId: q.branchId } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.q ? { OR: [{ summary: { contains: q.q, mode: 'insensitive' as const } }, { actor: { name: { contains: q.q, mode: 'insensitive' as const } } }] } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: new Date(`${q.from}T00:00:00+05:30`) } : {}), ...(q.to ? { lte: new Date(`${q.to}T23:59:59+05:30`) } : {}) } } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, ...paging(page, pageSize) }),
    ]);
    const branches = await this.prisma.branch.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.branchId).filter(Boolean) as string[])] } }, select: { id: true, code: true } });
    return { total, page, pageSize, rows: rows.map((r) => ({ ...r, branchCode: branches.find((b) => b.id === r.branchId)?.code ?? null })) };
  }

  @RequirePerm('audit.view')
  @Get('actions')
  async actions() {
    const rows = await this.prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
    return rows.map((r) => r.action);
  }
}

@Module({ controllers: [AdminsController, SettingsController, AuditController], providers: [PeopleService] })
export class AdminModule {}
