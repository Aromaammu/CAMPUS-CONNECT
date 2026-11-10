import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, Res } from '@nestjs/common';
import { ATTENDANCE_STATUS, AttStatus, PERFORMANCE_LABELS, SessionUser, attendancePercent, averageMark, can, formatDate, formatTime } from '@cc/shared';
import type { Response } from 'express';
import { CurrentUser } from '../../common/auth';
import type { Content } from 'pdfmake/interfaces';
import { PdfService } from '../../common/pdf.service';
import { PrismaService } from '../../common/prisma.service';

/** Student reports as PDF (PRD §10): attendance and performance. Payment and dues statements arrive with Accounts. */
@Controller('reports')
export class ReportsController {
  constructor(private prisma: PrismaService, private pdf: PdfService) {}

  private async student(user: SessionUser, studentId: string) {
    const id = studentId === 'me' ? user.studentId : studentId;
    if (!id) throw new ForbiddenException('Only students have reports');
    const s = await this.prisma.student.findUnique({ where: { id }, include: { user: { select: { name: true } }, branch: { select: { name: true, code: true } }, enrolments: { where: { status: { not: 'MOVED' } }, include: { batch: { include: { course: { select: { name: true } }, branch: { select: { code: true } }, teachers: { select: { employeeId: true } } } } } } } });
    if (!s) throw new NotFoundException('Student not found');
    const own = user.studentId === s.id;
    const staff = can(user, 'students.view', s.branchId);
    const teaches = !!user.employeeId && s.enrolments.some((e) => e.batch.teachers.some((t) => t.employeeId === user.employeeId));
    if (!own && !staff && !teaches) throw new ForbiddenException('You do not have access to this student');
    return s;
  }

  private send(res: Response, name: string, buf: Buffer) {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(buf);
  }

  @Get('students/:id/attendance.pdf')
  async attendance(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('batchId') batchId: string | undefined, @Res() res: Response) {
    const s = await this.student(user, id);
    const enrolments = s.enrolments.filter((e) => !batchId || e.batchId === batchId);
    const body: Content[] = [];
    for (const e of enrolments) {
      const rows = await this.prisma.attendance.findMany({ where: { studentId: s.id, session: { batchId: e.batchId } }, include: { session: { select: { position: true, startsAt: true } } }, orderBy: { session: { startsAt: 'asc' } } });
      const pct = attendancePercent(rows.map((r) => ({ status: r.status as AttStatus })));
      body.push({ text: `${e.batch.course.name} · ${e.batch.name} (${e.batch.branch.code})`, style: 'h2' });
      body.push({ text: `Attendance: ${pct === null ? 'no classes marked yet' : `${pct}%`} · Present ${rows.filter((r) => r.status === 'PRESENT').length}, Late ${rows.filter((r) => r.status === 'LATE').length}, Absent ${rows.filter((r) => r.status === 'ABSENT').length}, Excused ${rows.filter((r) => r.status === 'EXCUSED').length}`, margin: [0, 0, 0, 6] });
      if (rows.length) body.push(this.pdf.table(['Class', 'Date', 'Time', 'Status', 'Time in class', 'Note'], rows.map((r) => [
        r.session.position, formatDate(r.session.startsAt), formatTime(r.session.startsAt), ATTENDANCE_STATUS[r.status as AttStatus],
        r.attendedSeconds ? `${Math.round(r.attendedSeconds / 60)} min` : '–', r.reason ?? '',
      ]), [35, 65, 55, 50, 60, '*']));
    }
    if (!body.length) body.push({ text: 'No batches.', style: 'muted' });
    const buf = await this.pdf.render({ title: 'Attendance report', meta: [['Student', `${s.user.name} (${s.code})`], ['Branch', s.branch.name]], body });
    this.send(res, `attendance-${s.code}.pdf`, buf);
  }

  @Get('students/:id/performance.pdf')
  async performance(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('batchId') batchId: string | undefined, @Res() res: Response) {
    const s = await this.student(user, id);
    const enrolments = s.enrolments.filter((e) => !batchId || e.batchId === batchId);
    const body: Content[] = [];
    for (const e of enrolments) {
      const [marks, feedback] = await Promise.all([
        this.prisma.performance.findMany({ where: { studentId: s.id, session: { batchId: e.batchId } }, include: { session: { select: { position: true, startsAt: true } } }, orderBy: { session: { startsAt: 'asc' } } }),
        this.prisma.feedback.findMany({ where: { studentId: s.id, batchId: e.batchId, kind: { in: ['TEACHER_NOTE', 'TEACHER_MID', 'TEACHER_END'] } }, include: { from: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
      ]);
      const avg = averageMark(marks.map((m) => m.mark));
      body.push({ text: `${e.batch.course.name} · ${e.batch.name} (${e.batch.branch.code})`, style: 'h2' });
      body.push({ text: `Average mark: ${avg === null ? 'no marks yet' : `${avg} out of 5`}`, margin: [0, 0, 0, 6] });
      if (marks.length) body.push(this.pdf.table(['Class', 'Date', 'Mark', 'Remark'], marks.map((m) => [m.session.position, formatDate(m.session.startsAt), `${m.mark} · ${PERFORMANCE_LABELS[m.mark]}`, m.remark ?? '']), [35, 65, 110, '*']));
      if (feedback.length) {
        body.push({ text: 'Teacher feedback', bold: true, margin: [0, 10, 0, 4] });
        for (const f of feedback) {
          const ratings = f.ratings && typeof f.ratings === 'object' ? Object.entries(f.ratings as Record<string, number>).map(([k, v]) => `${k[0].toUpperCase()}${k.slice(1)} ${v}/5`).join(' · ') : '';
          body.push({ text: [{ text: `${formatDate(f.createdAt)} · ${f.from.name}${f.kind === 'TEACHER_MID' ? ' · mid-course' : f.kind === 'TEACHER_END' ? ' · end of course' : ''}: `, bold: true }, `${ratings}${ratings && f.comment ? ' · ' : ''}${f.comment ?? ''}`], margin: [0, 0, 0, 4] });
        }
      }
    }
    if (!body.length) body.push({ text: 'No batches.', style: 'muted' });
    const buf = await this.pdf.render({ title: 'Performance report', meta: [['Student', `${s.user.name} (${s.code})`], ['Branch', s.branch.name]], body });
    this.send(res, `performance-${s.code}.pdf`, buf);
  }
}
