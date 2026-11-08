import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { branchSchema, branchUpdateSchema, holidaySchema, roomSchema, SessionUser, Permission } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, RequirePerm, assertCan, branchesFor } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { copyTemplatesToBranch } from '../../seed/demo';

const d = (k?: string) => (k ? new Date(k) : undefined);

@Controller('branches')
export class BranchesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Branches the user can pick for a given permission (dropdowns). */
  @Get('options')
  async options(@CurrentUser() user: SessionUser, @Query('perm') perm?: string) {
    const p = (perm || 'branch.view') as Permission;
    const ids = user.kind === 'STUDENT' ? user.branchIds : branchesFor(user, p);
    return this.prisma.branch.findMany({
      where: { status: 'ACTIVE', ...(ids ? { id: { in: ids } } : {}) },
      select: { id: true, code: true, name: true },
      orderBy: { code: 'asc' },
    });
  }

  @RequirePerm('branch.view', 'branches.create')
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query('q') q?: string, @Query('status') status?: string) {
    const ids = user.kind === 'SUPER_ADMIN' || user.permissions.includes('branches.create') ? null : branchesFor(user, 'branch.view');
    const rows = await this.prisma.branch.findMany({
      where: {
        ...(ids ? { id: { in: ids } } : {}),
        ...(status ? { status: status as 'ACTIVE' | 'INACTIVE' } : {}),
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { code: 'asc' },
      include: { _count: { select: { students: true, employees: true, batches: true } } },
    });
    const admins = await this.prisma.employee.findMany({
      where: { branchId: { in: rows.map((r) => r.id) }, designation: { name: 'Branch Admin' }, user: { status: 'ACTIVE' } },
      select: { branchId: true, user: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...r, branchAdmins: admins.filter((a) => a.branchId === r.id).map((a) => a.user.name) }));
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    if (!user.permissions.includes('branches.create')) assertCan(user, 'branch.view', id);
    const b = await this.prisma.branch.findUnique({
      where: { id },
      include: {
        rooms: { orderBy: { name: 'asc' } },
        holidays: { orderBy: { date: 'asc' } },
        _count: { select: { students: true, employees: true, batches: true } },
      },
    });
    if (!b) throw new NotFoundException('Branch not found');
    const admins = await this.prisma.employee.findMany({
      where: { branchId: id, designation: { name: 'Branch Admin' } },
      select: { id: true, code: true, user: { select: { name: true, email: true, mobile: true, status: true } } },
    });
    return { ...b, branchAdmins: admins };
  }

  @RequirePerm('branches.create')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(branchSchema)) body: z.infer<typeof branchSchema>) {
    const exists = await this.prisma.branch.findUnique({ where: { code: body.code } });
    if (exists) throw new BadRequestException({ message: 'That branch code is already used', fieldErrors: { code: 'That branch code is already used' } });
    return this.prisma.$transaction(async (tx) => {
      const b = await tx.branch.create({ data: { ...body, openedOn: d(body.openedOn) } });
      await copyTemplatesToBranch(tx, b.id);
      await this.audit.record({ actorId: user.id, action: 'branch.create', entity: 'Branch', entityId: b.id, branchId: b.id, summary: `Created branch ${b.code}`, after: b }, tx);
      return b;
    });
  }

  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(branchUpdateSchema)) body: z.infer<typeof branchUpdateSchema>) {
    assertCan(user, 'branch.manage', id);
    const before = await this.prisma.branch.findUniqueOrThrow({ where: { id } });
    const after = await this.prisma.branch.update({ where: { id }, data: { ...body, openedOn: d(body.openedOn) ?? null } });
    await this.audit.record({ actorId: user.id, action: 'branch.update', entity: 'Branch', entityId: id, branchId: id, summary: `Updated branch ${after.code}`, before, after });
    return after;
  }

  @RequirePerm('branches.create')
  @Patch(':id/status')
  async setStatus(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }))) body: { status: 'ACTIVE' | 'INACTIVE' }) {
    const b = await this.prisma.branch.update({ where: { id }, data: { status: body.status } });
    await this.audit.record({ actorId: user.id, action: body.status === 'ACTIVE' ? 'branch.reopen' : 'branch.close', entity: 'Branch', entityId: id, branchId: id, summary: `${body.status === 'ACTIVE' ? 'Reopened' : 'Closed'} branch ${b.code}` });
    return b;
  }

  // ── Rooms ──
  @Post(':id/rooms')
  async addRoom(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(roomSchema)) body: z.infer<typeof roomSchema>) {
    assertCan(user, 'branch.manage', id);
    const r = await this.prisma.room.create({ data: { ...body, branchId: id } });
    await this.audit.record({ actorId: user.id, action: 'room.create', entity: 'Room', entityId: r.id, branchId: id, summary: `Added room ${r.name}` });
    return r;
  }

  @Put(':id/rooms/:roomId')
  async updateRoom(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('roomId') roomId: string, @Body(new Zod(roomSchema)) body: z.infer<typeof roomSchema>) {
    assertCan(user, 'branch.manage', id);
    const room = await this.prisma.room.findFirst({ where: { id: roomId, branchId: id } });
    if (!room) throw new NotFoundException('Room not found');
    const r = await this.prisma.room.update({ where: { id: roomId }, data: body });
    await this.audit.record({ actorId: user.id, action: 'room.update', entity: 'Room', entityId: r.id, branchId: id, summary: `Updated room ${r.name}`, before: room, after: r });
    return r;
  }

  // ── Holidays ──
  /** Head-office holidays (branchId null) + this branch's own. */
  @Get(':id/holidays')
  async holidays(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    if (user.kind !== 'STUDENT') assertCan(user, 'branch.view', id);
    return this.prisma.holiday.findMany({ where: { OR: [{ branchId: null }, { branchId: id }] }, orderBy: { date: 'asc' } });
  }

  @Post(':id/holidays')
  async addHoliday(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(holidaySchema)) body: z.infer<typeof holidaySchema>) {
    assertCan(user, 'branch.manage', id);
    const h = await this.prisma.holiday.create({ data: { branchId: id, date: new Date(body.date), name: body.name } });
    await this.audit.record({ actorId: user.id, action: 'holiday.create', entity: 'Holiday', entityId: h.id, branchId: id, summary: `Added branch holiday ${body.name} (${body.date})` });
    return h;
  }

  @Delete(':id/holidays/:holidayId')
  async removeHoliday(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('holidayId') holidayId: string) {
    assertCan(user, 'branch.manage', id);
    const h = await this.prisma.holiday.findFirst({ where: { id: holidayId, branchId: id } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id: holidayId } });
    await this.audit.record({ actorId: user.id, action: 'holiday.delete', entity: 'Holiday', entityId: holidayId, branchId: id, summary: `Removed branch holiday ${h.name}` });
    return { ok: true };
  }
}

/** Head-office holidays (all branches). */
@Controller('holidays')
export class HolidaysController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get()
  list(@Query('branchId') branchId?: string) {
    return this.prisma.holiday.findMany({
      where: branchId ? { OR: [{ branchId: null }, { branchId }] } : { branchId: null },
      orderBy: { date: 'asc' },
      include: { branch: { select: { code: true } } },
    });
  }

  @RequirePerm('settings.manage')
  @Post()
  async add(@CurrentUser() user: SessionUser, @Body(new Zod(holidaySchema)) body: z.infer<typeof holidaySchema>) {
    const h = await this.prisma.holiday.create({ data: { branchId: null, date: new Date(body.date), name: body.name } });
    await this.audit.record({ actorId: user.id, action: 'holiday.create', entity: 'Holiday', entityId: h.id, summary: `Added head-office holiday ${body.name} (${body.date})` });
    return h;
  }

  @RequirePerm('settings.manage')
  @Delete(':id')
  async remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const h = await this.prisma.holiday.findFirst({ where: { id, branchId: null } });
    if (!h) throw new NotFoundException('Holiday not found');
    await this.prisma.holiday.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'holiday.delete', entity: 'Holiday', entityId: id, summary: `Removed head-office holiday ${h.name}` });
    return { ok: true };
  }
}
