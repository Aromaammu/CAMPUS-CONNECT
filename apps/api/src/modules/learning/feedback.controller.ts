import { BadRequestException, Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import {
  PerformanceInput, SessionUser, TeacherFeedbackInput, averageMark, can, courseFeedbackSchema, performanceSchema, sessionRatingSchema, teacherFeedbackSchema,
} from '@cc/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AcademicsService } from '../academics/academics.service';
import { NotifyService } from '../notifications/notify.service';

const RATING_DAYS = 7;

/** PRD §9.2 per-class marks and §9.3 two-way feedback. */
@Controller()
export class FeedbackController {
  constructor(private prisma: PrismaService, private acad: AcademicsService, private settings: SettingsService, private notify: NotifyService) {}

  private async sessionWithBatch(id: string) {
    const s = await this.prisma.session.findUnique({ where: { id }, include: { batch: { include: { teachers: true } } } });
    if (!s) throw new NotFoundException('Class not found');
    return s;
  }

  /** Teacher of the batch (or the class's substitute), or branch staff who oversee classes. */
  private async assertTeach(user: SessionUser, batch: { id: string; branchId: string }) {
    if (can(user, 'attendance.oversee', batch.branchId)) return;
    if (await this.acad.isTeacher(user, batch.id)) return;
    throw new ForbiddenException('Only the batch teacher can do this');
  }

  // ── Performance (1–5 per class) ──

  @Get('performance/sessions/:id')
  async sessionMarks(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const s = await this.sessionWithBatch(id);
    await this.assertTeach(user, s.batch);
    const [enrolments, marks] = await Promise.all([
      this.prisma.enrolment.findMany({ where: { batchId: s.batchId, status: 'ACTIVE' }, include: { student: { select: { id: true, code: true, user: { select: { name: true } } } } }, orderBy: { student: { user: { name: 'asc' } } } }),
      this.prisma.performance.findMany({ where: { sessionId: id } }),
    ]);
    return {
      canEdit: Date.now() >= s.startsAt.getTime() && s.status !== 'CANCELLED',
      rows: enrolments.map((e) => {
        const m = marks.find((x) => x.studentId === e.studentId);
        return { studentId: e.studentId, name: e.student.user.name, code: e.student.code, mark: m?.mark ?? null, remark: m?.remark ?? null };
      }),
    };
  }

  @Put('performance/sessions/:id')
  async saveMarks(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(performanceSchema)) body: PerformanceInput) {
    const s = await this.sessionWithBatch(id);
    await this.assertTeach(user, s.batch);
    if (Date.now() < s.startsAt.getTime()) throw new BadRequestException('You can give marks once the class has started');
    if (s.status === 'CANCELLED') throw new BadRequestException('This class was cancelled');
    const ok = new Set((await this.prisma.enrolment.findMany({ where: { batchId: s.batchId }, select: { studentId: true } })).map((e) => e.studentId));
    if (body.marks.some((m) => !ok.has(m.studentId))) throw new BadRequestException('One of these students is not in this batch');
    await this.prisma.$transaction(async (tx) => {
      for (const m of body.marks) {
        if (m.mark === null) await tx.performance.deleteMany({ where: { sessionId: id, studentId: m.studentId } });
        else await tx.performance.upsert({
          where: { sessionId_studentId: { sessionId: id, studentId: m.studentId } },
          create: { sessionId: id, studentId: m.studentId, mark: m.mark, remark: m.remark ?? null, byId: user.id },
          update: { mark: m.mark, remark: m.remark ?? null, byId: user.id },
        });
      }
    });
    return { saved: body.marks.length };
  }

  /** Per-student averages for a batch (teacher / branch view). */
  @Get('batches/:id/performance')
  async batchPerformance(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const b = await this.acad.batchOr404(id);
    await this.assertTeach(user, b);
    const [enrolments, marks] = await Promise.all([
      this.prisma.enrolment.findMany({ where: { batchId: id, status: { in: ['ACTIVE', 'COMPLETED', 'ON_HOLD'] } }, include: { student: { select: { id: true, code: true, user: { select: { name: true } } } } }, orderBy: { student: { user: { name: 'asc' } } } }),
      this.prisma.performance.findMany({ where: { session: { batchId: id } }, select: { studentId: true, mark: true } }),
    ]);
    return enrolments.map((e) => {
      const mine = marks.filter((m) => m.studentId === e.studentId).map((m) => m.mark);
      return { studentId: e.studentId, name: e.student.user.name, code: e.student.code, average: averageMark(mine), marked: mine.length };
    });
  }

  // ── Teacher → student feedback ──

  @Post('feedback/teacher')
  async teacherFeedback(@CurrentUser() user: SessionUser, @Body(new Zod(teacherFeedbackSchema)) body: TeacherFeedbackInput) {
    const b = await this.acad.batchOr404(body.batchId);
    await this.assertTeach(user, b);
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: body.studentId, batchId: b.id } }, include: { student: { select: { userId: true } } } });
    if (!e || e.status === 'MOVED') throw new BadRequestException('This student is not in the batch');
    const data = { kind: body.kind, fromUserId: user.id, studentId: body.studentId, batchId: b.id, comment: body.comment ?? null, ratings: body.kind === 'TEACHER_NOTE' ? undefined : body.ratings };
    let row;
    if (body.kind === 'TEACHER_NOTE') row = await this.prisma.feedback.create({ data });
    else {
      // One mid-course and one end-of-course form per student and batch: saving again updates it.
      const prev = await this.prisma.feedback.findFirst({ where: { kind: body.kind, studentId: body.studentId, batchId: b.id } });
      row = prev ? await this.prisma.feedback.update({ where: { id: prev.id }, data }) : await this.prisma.feedback.create({ data });
    }
    await this.notify.send(e.student.userId, { type: 'N10', title: `${user.name} gave you feedback`, body: b.name, link: '/learn/performance' });
    return row;
  }

  @Get('batches/:id/feedback')
  async batchFeedback(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('studentId') studentId?: string) {
    const b = await this.acad.batchOr404(id);
    await this.assertTeach(user, b);
    return this.prisma.feedback.findMany({
      where: { batchId: id, kind: { in: ['TEACHER_NOTE', 'TEACHER_MID', 'TEACHER_END'] }, ...(studentId ? { studentId } : {}) },
      include: { from: { select: { name: true } }, student: { select: { code: true, user: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 200,
    });
  }

  // ── Student → class / course ──

  /** Classes a student attended in the last week and has not rated yet. */
  @Get('me/feedback-due')
  async due(@CurrentUser() user: SessionUser) {
    if (!user.studentId) return [];
    const since = new Date(Date.now() - RATING_DAYS * 86400_000);
    const rows = await this.prisma.attendance.findMany({
      where: { studentId: user.studentId, status: { in: ['PRESENT', 'LATE'] }, session: { endsAt: { gte: since, lte: new Date() }, status: 'COMPLETED' } },
      include: { session: { select: { id: true, position: true, startsAt: true, batch: { select: { id: true, name: true, course: { select: { name: true } } } } } } },
      orderBy: { session: { startsAt: 'desc' } },
    });
    const rated = new Set((await this.prisma.feedback.findMany({ where: { kind: 'STUDENT_SESSION', studentId: user.studentId, sessionId: { in: rows.map((r) => r.sessionId) } }, select: { sessionId: true } })).map((f) => f.sessionId));
    return rows.filter((r) => !rated.has(r.sessionId)).map((r) => r.session);
  }

  @Post('feedback/sessions/:id/rating')
  async rate(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(sessionRatingSchema)) body: z.infer<typeof sessionRatingSchema>) {
    if (!user.studentId) throw new ForbiddenException('Only students rate classes');
    const s = await this.sessionWithBatch(id);
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId: s.batchId } } });
    if (!e || e.status === 'MOVED' || e.status === 'DROPPED') throw new ForbiddenException('You are not in this batch');
    if (s.status === 'CANCELLED' || (s.status !== 'COMPLETED' && s.status !== 'LIVE' && Date.now() < s.endsAt.getTime())) throw new BadRequestException('You can rate a class once it has run');
    if (Date.now() > s.endsAt.getTime() + RATING_DAYS * 86400_000) throw new BadRequestException(`Classes can be rated for ${RATING_DAYS} days`);
    const teacherId = s.teacherId ?? s.batch.teachers.find((t) => t.role === 'MAIN')?.employeeId ?? null;
    const prev = await this.prisma.feedback.findFirst({ where: { kind: 'STUDENT_SESSION', studentId: user.studentId, sessionId: id } });
    const data = { kind: 'STUDENT_SESSION', fromUserId: user.id, studentId: user.studentId, batchId: s.batchId, sessionId: id, teacherId, rating: body.rating, comment: body.comment ?? null };
    return prev ? this.prisma.feedback.update({ where: { id: prev.id }, data }) : this.prisma.feedback.create({ data });
  }

  @Post('feedback/course')
  async course(@CurrentUser() user: SessionUser, @Body(new Zod(courseFeedbackSchema)) body: z.infer<typeof courseFeedbackSchema>) {
    if (!user.studentId) throw new ForbiddenException('Only students give course feedback');
    const b = await this.acad.batchOr404(body.batchId);
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId: b.id } } });
    if (!e || e.status === 'MOVED' || e.status === 'DROPPED') throw new ForbiddenException('You are not in this batch');
    const teacherId = b.teachers.find((t) => t.role === 'MAIN')?.employeeId ?? null;
    const avg = Math.round(Object.values(body.ratings).reduce((a, x) => a + x, 0) / Object.values(body.ratings).length);
    const prev = await this.prisma.feedback.findFirst({ where: { kind: 'STUDENT_COURSE', studentId: user.studentId, batchId: b.id } });
    const data = { kind: 'STUDENT_COURSE', fromUserId: user.id, studentId: user.studentId, batchId: b.id, teacherId, rating: avg, ratings: body.ratings, comment: body.comment ?? null };
    return prev ? this.prisma.feedback.update({ where: { id: prev.id }, data }) : this.prisma.feedback.create({ data });
  }

  /** S6: my marks per batch, the teacher's feedback to me, and what I gave. */
  @Get('me/performance')
  async mine(@CurrentUser() user: SessionUser) {
    if (!user.studentId) throw new ForbiddenException('Only students have performance');
    const enrolments = await this.prisma.enrolment.findMany({
      where: { studentId: user.studentId, status: { not: 'MOVED' } },
      include: { batch: { include: { course: { select: { name: true } }, branch: { select: { code: true } } } } }, orderBy: { enrolledOn: 'desc' },
    });
    const out = [];
    for (const e of enrolments) {
      const [marks, feedback, myCourse] = await Promise.all([
        this.prisma.performance.findMany({ where: { studentId: user.studentId, session: { batchId: e.batchId } }, include: { session: { select: { position: true, startsAt: true } } }, orderBy: { session: { startsAt: 'desc' } } }),
        this.prisma.feedback.findMany({ where: { studentId: user.studentId, batchId: e.batchId, kind: { in: ['TEACHER_NOTE', 'TEACHER_MID', 'TEACHER_END'] } }, include: { from: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
        this.prisma.feedback.findFirst({ where: { studentId: user.studentId, batchId: e.batchId, kind: 'STUDENT_COURSE' } }),
      ]);
      out.push({
        batch: { id: e.batchId, name: e.batch.name, course: e.batch.course.name, branch: e.batch.branch.code },
        average: averageMark(marks.map((m) => m.mark)),
        marks: marks.map((m) => ({ sessionId: m.sessionId, position: m.session.position, startsAt: m.session.startsAt, mark: m.mark, remark: m.remark })),
        feedback: feedback.map((f) => ({ id: f.id, kind: f.kind, from: f.from.name, comment: f.comment, ratings: f.ratings, createdAt: f.createdAt })),
        courseFeedback: myCourse ? { ratings: myCourse.ratings, comment: myCourse.comment, createdAt: myCourse.createdAt } : null,
      });
    }
    return out;
  }

  /** T7: ratings students gave me (averages; names only if the setting allows), per batch. */
  @Get('feedback/received')
  async received(@CurrentUser() user: SessionUser, @Query('batchId') batchId?: string) {
    const showNames = await this.settings.get('feedback.showRaterToTeacher');
    let where;
    if (batchId) {
      const b = await this.acad.batchOr404(batchId);
      await this.assertTeach(user, b);
      where = { batchId };
    } else {
      if (!user.employeeId) throw new ForbiddenException('Only teachers receive ratings');
      where = { teacherId: user.employeeId };
    }
    const rows = await this.prisma.feedback.findMany({
      where: { ...where, kind: { in: ['STUDENT_SESSION', 'STUDENT_COURSE'] } },
      include: { from: { select: { name: true } }, session: { select: { position: true, startsAt: true } } },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    const batchIds = [...new Set(rows.map((r) => r.batchId))];
    const batches = await this.prisma.batch.findMany({ where: { id: { in: batchIds } }, select: { id: true, name: true, branch: { select: { code: true } } } });
    const byBatch = batches.map((b) => {
      const mine = rows.filter((r) => r.batchId === b.id);
      const sessions = mine.filter((r) => r.kind === 'STUDENT_SESSION');
      const course = mine.filter((r) => r.kind === 'STUDENT_COURSE');
      return {
        batch: { id: b.id, name: b.name, branch: b.branch.code },
        classAverage: averageMark(sessions.map((r) => r.rating ?? 0).filter(Boolean)), classRatings: sessions.length,
        courseAverage: averageMark(course.map((r) => r.rating ?? 0).filter(Boolean)), courseRatings: course.length,
        comments: mine.filter((r) => r.comment).slice(0, 30).map((r) => ({ id: r.id, kind: r.kind, rating: r.rating, comment: r.comment, createdAt: r.createdAt, classPosition: r.session?.position ?? null, from: showNames ? r.from.name : null })),
      };
    });
    return { showNames, batches: byBatch };
  }
}
