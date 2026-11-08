import {
  BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { STUDENT_IMPORT_COLUMNS, SessionUser, can, emailSchema, mobileSchema, parseDdMmYyyy, studentSchema, studentStatusSchema } from '@cc/shared';
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
  status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'DROPPED']).optional(),
  batchId: z.string().optional(),
});

const include = {
  user: { select: { id: true, name: true, email: true, mobile: true, status: true, lastLoginAt: true, mustChangePassword: true } },
  branch: { select: { id: true, code: true, name: true } },
} as const;

@Controller('students')
export class StudentsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private ids: IdService, private people: PeopleService) {}

  @RequirePerm('students.view')
  @Get()
  async list(@CurrentUser() user: SessionUser, @Query() query: Record<string, string>) {
    const q = listQuery.parse(query);
    const ids = branchesFor(user, 'students.view');
    if (q.branchId && ids && !ids.includes(q.branchId)) throw new ForbiddenException('You do not have access to this branch');
    const where = {
      AND: [
        q.branchId ? { branchId: q.branchId } : ids ? { OR: [{ branchId: { in: ids } }, { enrolments: { some: { batch: { branchId: { in: ids } } } } }] } : {},
        q.status ? { status: q.status } : {},
        q.batchId ? { enrolments: { some: { batchId: q.batchId } } } : {},
        q.q ? { OR: [{ code: { contains: q.q, mode: 'insensitive' as const } }, { user: { name: { contains: q.q, mode: 'insensitive' as const } } }, { user: { email: { contains: q.q, mode: 'insensitive' as const } } }, { user: { mobile: { contains: q.q } } }] } : {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.student.count({ where }),
      this.prisma.student.findMany({ where, include: { ...include, _count: { select: { enrolments: true } } }, orderBy: { user: { name: 'asc' } }, ...paging(q.page, q.pageSize) }),
    ]);
    return { total, page: q.page, pageSize: q.pageSize, rows };
  }

  /** Branches whose staff may see this student: home branch + branches of their batches. */
  private async studentBranches(studentId: string) {
    const s = await this.prisma.student.findUnique({ where: { id: studentId }, select: { branchId: true, enrolments: { select: { batch: { select: { branchId: true } } } } } });
    if (!s) throw new NotFoundException('Student not found');
    return [s.branchId, ...s.enrolments.map((e) => e.batch.branchId)];
  }

  @Get(':id')
  async get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    if (user.kind === 'STUDENT') {
      if (user.studentId !== id) throw new ForbiddenException('You do not have access to this');
    } else {
      const branches = await this.studentBranches(id);
      if (!branches.some((b) => can(user, 'students.view', b))) throw new ForbiddenException('You do not have access to this');
    }
    return this.prisma.student.findUniqueOrThrow({ where: { id }, include });
  }

  @RequirePerm('students.manage')
  @Post()
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(studentSchema)) body: z.infer<typeof studentSchema>) {
    assertCan(user, 'students.manage', body.branchId);
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: body.branchId } });
    const s = await this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile);
      const u = await this.people.createUser(tx, { kind: 'STUDENT', name: body.name, email: body.email, mobile: body.mobile });
      const code = await this.ids.studentCode(tx, branch.id, branch.code);
      const st = await tx.student.create({
        data: { userId: u.id, code, branchId: branch.id, dob: body.dob ? new Date(body.dob) : null, address: body.address, guardianName: body.guardianName, guardianPhone: body.guardianPhone },
        include,
      });
      await this.audit.record({ actorId: user.id, action: 'student.create', entity: 'Student', entityId: st.id, branchId: branch.id, summary: `Added student ${body.name} (${code})`, after: body }, tx);
      return st;
    });
    await this.people.sendWelcome(s.userId);
    return s;
  }

  @RequirePerm('students.manage')
  @Put(':id')
  async update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(studentSchema)) body: z.infer<typeof studentSchema>) {
    const before = await this.prisma.student.findUnique({ where: { id }, include });
    if (!before) throw new NotFoundException('Student not found');
    assertCan(user, 'students.manage', before.branchId);
    if (body.branchId !== before.branchId) assertCan(user, 'students.manage', body.branchId);
    return this.prisma.$transaction(async (tx) => {
      await this.people.assertUnique(tx, body.email, body.mobile, before.userId);
      await tx.user.update({ where: { id: before.userId }, data: { name: body.name, email: body.email ?? null, mobile: body.mobile } });
      const after = await tx.student.update({
        where: { id },
        data: { branchId: body.branchId, dob: body.dob ? new Date(body.dob) : null, address: body.address ?? null, guardianName: body.guardianName ?? null, guardianPhone: body.guardianPhone ?? null },
        include,
      });
      await this.audit.record({ actorId: user.id, action: 'student.update', entity: 'Student', entityId: id, branchId: before.branchId, summary: `Updated student ${body.name} (${after.code})`, before, after: body }, tx);
      return after;
    });
  }

  @RequirePerm('students.manage')
  @Patch(':id/status')
  async setStatus(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(studentStatusSchema)) body: z.infer<typeof studentStatusSchema>) {
    const s = await this.prisma.student.findUnique({ where: { id }, include: { user: true } });
    if (!s) throw new NotFoundException('Student not found');
    assertCan(user, 'students.manage', s.branchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data: { status: body.status } });
      await this.audit.record({ actorId: user.id, action: 'student.status', entity: 'Student', entityId: id, branchId: s.branchId, summary: `Changed ${s.user.name} to ${body.status}${body.note ? `: ${body.note}` : ''}`, before: { status: s.status }, after: { status: body.status } }, tx);
    });
    return { ok: true };
  }

  @RequirePerm('students.manage')
  @Patch(':id/login')
  async setLogin(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(z.object({ active: z.boolean() }))) body: { active: boolean }) {
    const s = await this.prisma.student.findUnique({ where: { id }, include: { user: true } });
    if (!s) throw new NotFoundException('Student not found');
    assertCan(user, 'students.manage', s.branchId);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: s.userId }, data: { status: body.active ? 'ACTIVE' : 'INACTIVE' } });
      if (!body.active) await this.people.revokeSessions(tx, s.userId);
      await this.audit.record({ actorId: user.id, action: body.active ? 'student.login_on' : 'student.login_off', entity: 'Student', entityId: id, branchId: s.branchId, summary: `${body.active ? 'Allowed' : 'Blocked'} login for ${s.user.name}` }, tx);
    });
    return { ok: true };
  }

  @RequirePerm('students.manage')
  @Post(':id/password-link')
  async passwordLink(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const s = await this.prisma.student.findUnique({ where: { id }, include: { user: true } });
    if (!s) throw new NotFoundException('Student not found');
    assertCan(user, 'students.manage', s.branchId);
    await this.people.sendWelcome(s.userId, 'reset');
    await this.audit.record({ actorId: user.id, action: 'student.password_link', entity: 'Student', entityId: id, branchId: s.branchId, summary: `Sent a set-password link to ${s.user.name}` });
    return { ok: true };
  }

  // ── Excel bulk upload ──
  @RequirePerm('students.manage')
  @Get('import/template')
  async template(@Res() res: Response) {
    const buf = await templateWorkbook('Students', STUDENT_IMPORT_COLUMNS, ['Meera Krishnan', '9876543210', 'meera@example.com', '15-08-2004', 'Kakkanad, Kochi', 'Krishnan K', '9846012345'], [
      'Fill one student per row on the "Students" sheet. Do not change the column headings.',
      'Required: Full name and Mobile (10-digit Indian number). Email is strongly recommended.',
      'Dates are DD-MM-YYYY. Each student receives a welcome email/SMS with a link to set their password.',
      'Upload the file, check the report, then press Import to add the rows without errors.',
    ]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="students-template.xlsx"');
    res.send(buf);
  }

  @RequirePerm('students.manage')
  @Post('import')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async import(@CurrentUser() user: SessionUser, @Query('branchId') branchId: string, @Query('commit') commit: string, @UploadedFile() file?: Express.Multer.File) {
    if (!branchId) throw new BadRequestException('Choose a branch');
    assertCan(user, 'students.manage', branchId);
    if (!file) throw new BadRequestException('Choose a file to upload');
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: branchId } });
    const rows = await readSheet(file.buffer, STUDENT_IMPORT_COLUMNS);
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
      const dob = parseDdMmYyyy(data.dob);
      if (dob === 'invalid') errors.push('Date of birth must be DD-MM-YYYY');
      const gp = data.guardianPhone ? mobileSchema.safeParse(String(data.guardianPhone)) : null;
      if (gp && !gp.success) errors.push('Guardian mobile must be a 10-digit Indian number');
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
      report.push({
        row, name, ok: errors.length === 0, errors,
        value: { name, mobile: mobile.success ? mobile.data : '', email: email?.success ? email.data : undefined, dob, address: data.address ? String(data.address) : undefined, guardianName: data.guardianName ? String(data.guardianName) : undefined, guardianPhone: gp?.success ? gp.data : undefined },
      });
    }
    const good = report.filter((r) => r.ok);
    let created = 0;
    if (commit === '1' && good.length) {
      const newUserIds: string[] = [];
      await this.prisma.$transaction(async (tx) => {
        for (const r of good) {
          const v = r.value;
          const u = await this.people.createUser(tx, { kind: 'STUDENT', name: v.name, email: v.email, mobile: v.mobile });
          const code = await this.ids.studentCode(tx, branch.id, branch.code);
          await tx.student.create({ data: { userId: u.id, code, branchId, dob: v.dob && v.dob !== 'invalid' ? new Date(v.dob) : null, address: v.address, guardianName: v.guardianName, guardianPhone: v.guardianPhone } });
          newUserIds.push(u.id);
        }
        await this.audit.record({ actorId: user.id, action: 'student.import', entity: 'Student', branchId, summary: `Imported ${good.length} students from Excel` }, tx);
      }, { timeout: 120000 });
      for (const id of newUserIds) await this.people.sendWelcome(id);
      created = good.length;
    }
    return { total: report.length, valid: good.length, invalid: report.length - good.length, created, rows: report.map(({ value: _v, ...r }) => r) };
  }
}
