import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionUser, announcementSchema, can } from '@cc/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit.service';
import { CurrentUser, RequirePerm } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { NotifyService } from '../notifications/notify.service';

type Input = z.infer<typeof announcementSchema>;

/** PRD §12 announcements: head office → all or chosen branches; Branch Admin → their branch or batches. Read-only, with read counts. */
@Controller('announcements')
export class AnnouncementsController {
  constructor(private prisma: PrismaService, private notify: NotifyService, private audit: AuditService) {}

  /** Everyone an announcement reaches. */
  async recipients(a: Pick<Input, 'scope' | 'branchIds' | 'batchIds' | 'audience'>, authorId: string) {
    const staff = a.audience !== 'STUDENTS';
    const students = a.audience !== 'STAFF';
    const ids = new Set<string>();
    if (a.scope === 'ALL') {
      const rows = await this.prisma.user.findMany({ where: { status: 'ACTIVE', kind: { in: [...(staff ? ['ADMIN', 'EMPLOYEE', 'SUPER_ADMIN'] as const : []), ...(students ? ['STUDENT'] as const : [])] } }, select: { id: true } });
      rows.forEach((r) => ids.add(r.id));
    } else if (a.scope === 'BRANCHES') {
      if (staff) (await this.prisma.employee.findMany({ where: { user: { status: 'ACTIVE' }, OR: [{ branchId: { in: a.branchIds } }, { extraBranches: { some: { branchId: { in: a.branchIds } } } }] }, select: { userId: true } })).forEach((e) => ids.add(e.userId));
      if (students) (await this.prisma.student.findMany({ where: { user: { status: 'ACTIVE' }, OR: [{ branchId: { in: a.branchIds } }, { enrolments: { some: { status: 'ACTIVE', batch: { branchId: { in: a.branchIds } } } } }] }, select: { userId: true } })).forEach((s) => ids.add(s.userId));
    } else {
      if (staff) (await this.prisma.batchTeacher.findMany({ where: { batchId: { in: a.batchIds } }, select: { employee: { select: { userId: true } } } })).forEach((t) => ids.add(t.employee.userId));
      if (students) (await this.prisma.enrolment.findMany({ where: { batchId: { in: a.batchIds }, status: 'ACTIVE' }, select: { student: { select: { userId: true } } } })).forEach((e) => ids.add(e.student.userId));
    }
    ids.delete(authorId);
    return [...ids];
  }

  @Post()
  @RequirePerm('announcements.send')
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(announcementSchema)) body: Input) {
    if (body.scope === 'ALL' && user.branchIds !== null) throw new ForbiddenException('Only head office can announce to every branch');
    if (body.scope === 'BRANCHES' && body.branchIds.some((b) => !can(user, 'announcements.send', b))) throw new ForbiddenException('You can only announce to your own branches');
    if (body.scope === 'BATCHES') {
      const batches = await this.prisma.batch.findMany({ where: { id: { in: body.batchIds } }, select: { id: true, branchId: true } });
      if (batches.length !== new Set(body.batchIds).size) throw new BadRequestException('Batch not found');
      if (batches.some((b) => !can(user, 'announcements.send', b.branchId))) throw new ForbiddenException('You can only announce to batches in your branches');
    }
    const a = await this.prisma.announcement.create({
      data: { authorId: user.id, title: body.title, body: body.body, scope: body.scope, branchIds: body.scope === 'BRANCHES' ? body.branchIds : [], batchIds: body.scope === 'BATCHES' ? body.batchIds : [], audience: body.audience },
    });
    const to = await this.recipients(body, user.id);
    await this.notify.sendMany(to, { type: 'N18', title: `Announcement: ${body.title}`, body: body.body.slice(0, 140), link: '/announcements/inbox' });
    await this.audit.record({ actorId: user.id, action: 'announcement.send', entity: 'Announcement', entityId: a.id, branchId: body.branchIds[0] ?? null, summary: `Sent "${body.title}" to ${to.length} people` });
    return { ...a, recipients: to.length };
  }

  /** What reaches me, newest first, with whether I read it. */
  @Get('mine')
  async mine(@CurrentUser() user: SessionUser, @Query('page') page = '1') {
    const myBranches = new Set<string>();
    const myBatches = new Set<string>();
    if (user.employeeId) {
      (user.branchIds ?? []).forEach((b) => myBranches.add(b));
      (await this.prisma.batchTeacher.findMany({ where: { employeeId: user.employeeId }, select: { batchId: true } })).forEach((t) => myBatches.add(t.batchId));
    }
    if (user.studentId) {
      const s = await this.prisma.student.findUniqueOrThrow({ where: { id: user.studentId }, select: { branchId: true, enrolments: { where: { status: 'ACTIVE' }, select: { batchId: true, batch: { select: { branchId: true } } } } } });
      myBranches.add(s.branchId);
      s.enrolments.forEach((e) => { myBatches.add(e.batchId); myBranches.add(e.batch.branchId); });
    }
    const audiences = user.kind === 'STUDENT' ? ['EVERYONE', 'STUDENTS'] : ['EVERYONE', 'STAFF'];
    const where: Prisma.AnnouncementWhereInput = {
      audience: { in: audiences },
      OR: [
        { scope: 'ALL' },
        { scope: 'BRANCHES', branchIds: { hasSome: [...myBranches] } },
        { scope: 'BATCHES', batchIds: { hasSome: [...myBatches] } },
        { authorId: user.id },
      ],
    };
    const take = 20;
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;
    const [total, rows] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({ where, include: { author: { select: { name: true } }, reads: { where: { userId: user.id }, select: { at: true } } }, orderBy: { createdAt: 'desc' }, take, skip }),
    ]);
    const unread = await this.prisma.announcement.count({ where: { ...where, authorId: { not: user.id }, reads: { none: { userId: user.id } } } });
    return { total, unread, page: Number(page) || 1, pageSize: take, rows: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, author: r.author.name, createdAt: r.createdAt, read: r.reads.length > 0 || r.authorId === user.id })) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    if (!(await this.prisma.announcement.count({ where: { id } }))) throw new NotFoundException('Announcement not found');
    await this.prisma.announcementRead.upsert({ where: { announcementId_userId: { announcementId: id, userId: user.id } }, create: { announcementId: id, userId: user.id }, update: {} });
    return { ok: true };
  }

  /** AD13: announcements I can see as a sender, with reach and read counts. */
  @Get('sent')
  @RequirePerm('announcements.send')
  async sent(@CurrentUser() user: SessionUser) {
    const where: Prisma.AnnouncementWhereInput = user.branchIds === null ? {} : { authorId: user.id };
    const rows = await this.prisma.announcement.findMany({ where, include: { author: { select: { name: true } }, _count: { select: { reads: true } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const branches = await this.prisma.branch.findMany({ select: { id: true, code: true } });
    const batches = await this.prisma.batch.findMany({ where: { id: { in: rows.flatMap((r) => r.batchIds) } }, select: { id: true, name: true } });
    const out = [];
    for (const r of rows) {
      const reach = (await this.recipients({ scope: r.scope as Input['scope'], branchIds: r.branchIds, batchIds: r.batchIds, audience: r.audience as Input['audience'] }, r.authorId)).length;
      out.push({
        id: r.id, title: r.title, body: r.body, author: r.author.name, createdAt: r.createdAt, scope: r.scope, audience: r.audience, reads: r._count.reads, reach,
        target: r.scope === 'ALL' ? 'All branches' : r.scope === 'BRANCHES' ? r.branchIds.map((b) => branches.find((x) => x.id === b)?.code ?? '?').join(', ') : r.batchIds.map((b) => batches.find((x) => x.id === b)?.name ?? '?').join(', '),
      });
    }
    return out;
  }
}
