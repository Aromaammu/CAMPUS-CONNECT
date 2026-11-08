import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BRANCH_PERMISSIONS, EMPLOYEE_IMPORT_COLUMNS, Permission, SessionUser, can, employeeSchema, emailSchema, mobileSchema, parseDdMmYyyy } from '@cc/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CurrentUser, RequirePerm, assertCan, branchesFor } from '../../common/org-access';
import { Zod, paging } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';
import { IdService } from '../../common/ids.service';
import { PeopleService, readSheet, templateWorkbook } from './people.service';

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().optional(),
  branchId: z.string().optional(),
  designationId: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const include = {
  user: { select: { id: true, name: true, email: true, mobile: true, status: true, lastLoginAt: true } },
  branch: { select: { id: true, code: true, name: true } },
  designation: { select: { id: true, name: true, permissions: true } },
  department: { select: { id: true, name: true } },
  extraBranches: { select: { branch: { select: { id: true, code: true, name: true } } } },
} as const;

const BRANCH_PERMS = new Set<string>(BRANCH_PERMISSIONS);

@Controller('employees')
export class EmployeesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ids: IdService, private people: PeopleService) {}

  private scopeWhere(user: SessionUser, perm: Permission, branchId?: string) {
    const ids = branchesFor(user, perm);
    if (branchId) {
      if (ids && !ids.includes(branchId)) return { id: '__none__' };
      return { OR: [{ branchId }, { extraBranches: { some: { branchId } } }] };
    }
    if (!ids) return {};
    return { OR: [{ branchId: { in: ids } }, { extraBranches: { some: { branchId: { in: ids } } } }] };
  }

  @RequirePerm('employees.view')
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query() query: Record<string, string>) {
    const q = listQuery.parse(query);
    const where = {
      AND: [
        this.scopeWhere(user, 'employees.view', q.branchId),
        q.designationId ? { designationId: q.designationId } : {},
        q.status ? { user: { status: q.status } } : {},
        q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' as const } }, { user: { name: { contains: q.q, mode: 'insensitive' as const } } }, { user: { email: { contains: q.q, mode: 'insensitive' as const } } }, { user: { mobile: { contains: q.q } } }] } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({ where, include, orderBy: { user: { name: 'asc' } }, ...paging(q.page, q.pageSize) }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  }

  /** Staff who hold a permission in a branch (e.g. teachers for a batch). */
  @Get('options')
  async options(@CurrentUser() user: SessionUser, @Query('branchId') branchId: string, @Query('perm') perm = 'sessions.teach') {
    if (!branchId) throw new BadRequestException('Choose a branch');
    if (user.kind === 'STUDENT') return [];
    const rows = await this.prisma.employee.findMany({
      where: { OR: [{ branchId }, { extraBranches: { some: { branchId } } }], user: { status: 'ACTIVE' } },
      include: { user: { select: { id: true, name: true } }, designation: { select: { name: true, permissions: true } } },
      orderBy: { user: { name: 'asc' } },
    });
    return rows
      .filter((e) => {
        const set = new Set([...e.designation.permissions, ...e.extraPermissions]);
        e.removedPermissions.forEach((p) => set.delete(p));
        return set.has(perm);
      })
      .map((e) => ({ id: e.id, userId: e.user.id, name: e.user.name, code: e.code, designation: e.designation.name }));
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include });
    if (!e) throw new NotFoundException('Employee not found');
    const branches = [e.branchId, ...e.extraBranches.map((x) => x.branch.id)];
    if (!branches.some((b) => can(user, 'employees.view', b))) throw new ForbiddenException('You do not have access to this');
    return e;
  }

  private async validateRefs(user: SessionUser, body: z.infer<typeof employeeSchema>) {
    assertCan(user, 'employees.manage', body.branchId);
    for (const b of body.extraBranchIds) {
      if (b === body.branchId) continue;
      assertCan(user, 'employees.manage', b);
    }
    const des = await this.prisma.designation.findFirst({ where: { id: body.designationId, branchId: body.branchId } });
    if (!des) throw new BadRequestException({ message: 'Choose a designation from this branch', fieldErrors: { designationId: 'Choose a designation from this branch' } });
    const extra = body.extraPermissions.filter((p) => BRANCH_PERMS.has(p));
    const removed = body.removedPermissions.filter((p) => BRANCH_PERMS.has(p));
    return { des, extra, removed, extraBranchIds: [...new Set(body.extraBranchIds.filter((b) => b !== body.branchId))] };
  }

  @RequirePerm('employees.manage')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(employeeSchema)) body: z.infer<typeof employeeSchema>) {
    const { des, extra, removed, extraBranchIds } = await this.validateRefs(user, body);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: body.branchId } });
    const emp = await this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile);
      const u = await this.people.createUser(tx, { kind: 'EMPLOYEE', name: body.name, email: body.email, mobile: body.mobile });
      const code = await this.ids.employeeCode(tx, branch.id, branch.code);
      const e = await tx.employee.create({
        data: {
          userId: u.id, code, branchId: body.branchId, designationId: des.id, departmentId: body.departmentId ?? des.departmentId,
          joiningDate: body.joiningDate ? new Date(body.joiningDate) : null, extraPermissions: extra, removedPermissions: removed,
          extraBranches: { create: extraBranchIds.map((branchId) => ({ branchId })) },
        },
        include,
      });
      await this.audit.record({ actorId: user.id, action: 'employee.create', entity: 'Employee', entityId: e.id, branchId: body.branchId, summary: `Added ${body.name} (${code}) as ${des.name}`, after: body }, tx);
      return e;
    });
    await this.people.sendWelcome(emp.userId);
    return emp;
  }

  @RequirePerm('employees.manage')
  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(employeeSchema)) body: z.infer<typeof employeeSchema>) {
    const before = await this.prisma.employee.findUnique({ where: { id }, include });
    if (!before) throw new NotFoundException('Employee not found');
    assertCan(user, 'employees.manage', before.branchId);
    const { des, extra, removed, extraBranchIds } = await this.validateRefs(user, body);
    // Extra branches the editor cannot manage are kept as they were.
    const keep = before.extraBranches.map((x) => x.branch.id).filter((b) => !branchesFor(user, 'employees.manage')?.includes(b) && branchesFor(user, 'employees.manage') !== null);
    return this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile, before.userId);
      await tx.user.update({ where: { id: before.userId }, data: { name: body.name, email: body.email ?? null, mobile: body.mobile } });
      await tx.employeeBranch.deleteMany({ where: { employeeId: id } });
      const after = await tx.employee.update({
        where: { id },
        data: {
          branchId: body.branchId, designationId: des.id, departmentId: body.departmentId ?? des.departmentId,
          joiningDate: body.joiningDate ? new Date(body.joiningDate) : null, extraPermissions: extra, removedPermissions: removed,
          extraBranches: { create: [...new Set([...extraBranchIds, ...keep])].map((branchId) => ({ branchId })) },
        },
        include,
      });
      await this.audit.record({ actorId: user.id, action: 'employee.update', entity: 'Employee', entityId: id, branchId: body.branchId, summary: `Updated ${body.name} (${after.code})`, before, after: body }, tx);
      return after;
    });
  }

  @RequirePerm('employees.manage')
  @Patch(':id/status')
  async setStatus(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }))) body: { status: 'ACTIVE' | 'INACTIVE' }) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!e) throw new NotFoundException('Employee not found');
    assertCan(user, 'employees.manage', e.branchId);
    if (e.userId === user.id) throw new BadRequestException('You cannot deactivate your own account');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: e.userId }, data: { status: body.status } });
      if (body.status === 'INACTIVE') await this.people.revokeSessions(tx, e.userId);
      await this.audit.record({ actorId: user.id, action: body.status === 'ACTIVE' ? 'employee.reactivate' : 'employee.deactivate', entity: 'Employee', entityId: id, branchId: e.branchId, summary: `${body.status === 'ACTIVE' ? 'Reactivated' : 'Deactivated'} ${e.user.name}` }, tx);
    });
    return { ok: true };
  }

  @RequirePerm('employees.manage')
  @Post(':id/password-link')
  async passwordLink(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const e = await this.prisma.employee.findUnique({ where: { id }, include: { user: true } });
    if (!e) throw new NotFoundException('Employee not found');
    assertCan(user, 'employees.manage', e.branchId);
    await this.people.sendWelcome(e.userId, 'reset');
    await this.audit.record({ actorId: user.id, action: 'employee.password_link', entity: 'Employee', entityId: id, branchId: e.branchId, summary: `Sent a set-password link to ${e.user.name}` });
    return { ok: true };
  }

  // ── Excel bulk upload ──
  @RequirePerm('employees.manage')
  @Get('import/template')
  async template(@Res() res: Response) {
    const buf = await templateWorkbook('Employees', EMPLOYEE_IMPORT_COLUMNS, ['Anu Thomas', '9876543210', 'anu@example.com', 'Trainer', '01-12-2026'], [
      'Fill one employee per row on the "Employees" sheet. Do not change the column headings.',
      'Required: Full name, Mobile (10 digits), Designation (exactly as named in your branch, e.g. Trainer).',
      'Dates are DD-MM-YYYY. Each person receives a welcome email/SMS with a link to set their password.',
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="employees-template.xlsx"');
    res.send(buf);
  }

  @RequirePerm('employees.manage')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async import(@CurrentUser() user: SessionUser, @Query('branchId') branchId: string, @Query('commit') commit: string, @UploadedFile() file?: Express.Multer.File) {
    if (!branchId) throw new BadRequestException('Choose a branch');
    assertCan(user, 'employees.manage', branchId);
    if (!file) throw new BadRequestException('Choose a file to upload');
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const designations = await this.prisma.designation.findMany({ where: { branchId } });
    const rows = await readSheet(file.buffer, EMPLOYEE_IMPORT_COLUMNS);
    const seenEmail = new Set<string>();
    const seenMobile = new Set<string>();
    const report = [];
    for (const { row, data } of rows) {
      const errors: string[] = [];
      const name = String(data.name ?? '').trim();
      if (name.length < 2) errors.push('Full name is missing');
      const mobile = mobileSchema.safeParse(String(data.mobile ?? ''));
      if (!mobile.success) errors.push('Mobile must be a 10-digit Indian number');
      const email = data.email ? emailSchema.safeParse(String(data.email)) : null;
      if (email && !email.success) errors.push('Email is not valid');
      const des = designations.find((d) => d.name.toLowerCase() === String(data.designation ?? '').trim().toLowerCase());
      if (!des) errors.push(`Designation "${data.designation ?? ''}" does not exist in ${branch.code}`);
      const jd = parseDdMmYyyy(data.joiningDate);
      if (jd === 'invalid') errors.push('Joining date must be DD-MM-YYYY');
      if (mobile.success) {
        if (seenMobile.has(mobile.data)) errors.push('Mobile appears twice in this file');
        else if (await this.prisma.user.findUnique({ where: { mobile: mobile.data } })) errors.push('Mobile already belongs to an account');
        seenMobile.add(mobile.data);
      }
      if (email?.success) {
        if (seenEmail.has(email.data)) errors.push('Email appears twice in this file');
        else if (await this.prisma.user.findUnique({ where: { email: email.data } })) errors.push('Email already belongs to an account');
        seenEmail.add(email.data);
      }
      report.push({ row, name, ok: errors.length === 0, errors, value: { name, mobile: mobile.success ? mobile.data : '', email: email?.success ? email.data : undefined, designationId: des?.id, joiningDate: jd } });
    }
    const good = report.filter((r) => r.ok);
    let created = 0;
    if (commit === '1' && good.length) {
      const newUserIds: string[] = [];
      await this.prisma.$transaction(async (tx) => {
        for (const r of good) {
          const v = r.value;
          const u = await this.people.createUser(tx, { kind: 'EMPLOYEE', name: v.name, email: v.email, mobile: v.mobile });
          const code = await this.ids.employeeCode(tx, branch.id, branch.code);
          const des = designations.find((d) => d.id === v.designationId)!;
          await tx.employee.create({ data: { userId: u.id, code, branchId, designationId: des.id, departmentId: des.departmentId, joiningDate: v.joiningDate && v.joiningDate !== 'invalid' ? new Date(v.joiningDate) : null } });
          newUserIds.push(u.id);
        }
        await this.audit.record({ actorId: user.id, action: 'employee.import', entity: 'Employee', branchId, summary: `Imported ${good.length} employees from Excel` }, tx);
      }, { timeout: 120000 });
      for (const id of newUserIds) await this.people.sendWelcome(id);
      created = good.length;
    }
    return { total: report.length, valid: good.length, invalid: report.length - good.length, created, rows: report.map(({ value: _v, ...r }) => r) };
  }
}
