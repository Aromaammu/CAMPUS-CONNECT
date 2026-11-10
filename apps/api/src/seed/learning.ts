import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../config';

/**
 * Learning demo data (Phase 5): materials for Python Full Stack, marks and ratings for past classes,
 * teacher feedback, and final projects at every stage in Morning Batch A.
 */
export async function seedLearning(prisma: PrismaClient) {
  const anita = await prisma.user.findUniqueOrThrow({ where: { email: 'anita.trainer@demo.cc' }, include: { employee: true } });
  const morning = await prisma.batch.findFirstOrThrow({ where: { name: 'Morning Batch A' }, include: { course: { include: { modules: { orderBy: { position: 'asc' } } } } } });
  const tvm = await prisma.batch.findFirstOrThrow({ where: { name: 'Afternoon Batch' } });
  const m = morning.course.modules;

  // A small text file stored like any upload, plus links.
  const key = `material/seed/${randomUUID()}`;
  const text = 'Django cheat sheet\n\npython -m venv .venv\npip install django\ndjango-admin startproject mysite\npython manage.py runserver\n';
  mkdirSync(dirname(join(config.storageDir, key)), { recursive: true });
  writeFileSync(join(config.storageDir, key), text);
  const file = await prisma.fileObject.create({ data: { storageKey: key, name: 'django-cheat-sheet.txt', mime: 'text/plain; charset=utf-8', sizeBytes: Buffer.byteLength(text), uploadedById: anita.id, purpose: 'material' } });
  const both = [{ batchId: morning.id }, { batchId: tvm.id }];
  await prisma.material.create({ data: { courseId: morning.courseId, moduleId: m[0]?.id, title: 'Python official tutorial', kind: 'LINK', url: 'https://docs.python.org/3/tutorial/', uploadedById: anita.id, shares: { create: both } } });
  await prisma.material.create({ data: { courseId: morning.courseId, moduleId: m[3]?.id, title: 'Django cheat sheet', kind: 'FILE', fileId: file.id, uploadedById: anita.id, shares: { create: both } } });
  await prisma.material.create({ data: { courseId: morning.courseId, moduleId: m[2]?.id, title: 'PostgreSQL exercises', kind: 'LINK', url: 'https://pgexercises.com/', uploadedById: anita.id, shares: { create: [{ batchId: morning.id }] } } });

  // Marks and class ratings for attended past classes in Morning Batch A.
  const sessions = await prisma.session.findMany({ where: { batchId: morning.id, status: 'COMPLETED' }, orderBy: { startsAt: 'asc' }, include: { attendance: true } });
  let n = 0;
  for (const s of sessions) {
    for (const a of s.attendance) {
      if (a.status !== 'PRESENT' && a.status !== 'LATE') continue;
      n++;
      const mark = 2 + ((n * 7 + s.position) % 4); // 2–5
      await prisma.performance.create({ data: { sessionId: s.id, studentId: a.studentId, mark, remark: mark === 5 ? 'Excellent work' : mark === 2 ? 'Revise this topic' : null, byId: anita.id } });
      if (n % 3 === 0) {
        const st = await prisma.student.findUniqueOrThrow({ where: { id: a.studentId } });
        await prisma.feedback.create({ data: { kind: 'STUDENT_SESSION', fromUserId: st.userId, studentId: st.id, batchId: morning.id, sessionId: s.id, teacherId: anita.employee!.id, rating: 3 + (n % 3), comment: n % 6 === 0 ? 'Clear explanation, more practice time please' : null } });
      }
    }
  }

  // Teacher feedback and projects.
  const enrolments = await prisma.enrolment.findMany({ where: { batchId: morning.id, status: 'ACTIVE' }, include: { student: { include: { user: true } } }, orderBy: { student: { code: 'asc' } } });
  const arjun = enrolments.find((e) => e.student.user.email === 'arjun.student@demo.cc');
  const diya = enrolments.find((e) => e.student.user.email === 'diya.student@demo.cc');
  if (arjun) {
    await prisma.feedback.create({ data: { kind: 'TEACHER_NOTE', fromUserId: anita.id, studentId: arjun.studentId, batchId: morning.id, comment: 'Good progress on Django models. Practise writing forms with validation.' } });
    await prisma.feedback.create({ data: { kind: 'TEACHER_MID', fromUserId: anita.id, studentId: arjun.studentId, batchId: morning.id, ratings: { understanding: 4, practice: 3, participation: 5, punctuality: 4 }, comment: 'Asks great questions in class.' } });
  }
  await prisma.batch.update({ where: { id: morning.id }, data: { projectsOpen: true } });
  if (diya) {
    const p = await prisma.project.create({ data: { enrolmentId: diya.id, status: 'SUBMITTED' } });
    await prisma.projectSubmission.create({ data: { projectId: p.id, version: 1, title: 'Library management system', description: 'Django app with book search, loans and fines.', link: 'https://github.com/example/library-app' } });
  }
  const other = enrolments.find((e) => e.id !== arjun?.id && e.id !== diya?.id);
  if (other) {
    const p = await prisma.project.create({ data: { enrolmentId: other.id, status: 'TEACHER_APPROVED' } });
    await prisma.projectSubmission.create({ data: { projectId: p.id, version: 1, title: 'Expense tracker', description: 'First version', link: 'https://github.com/example/expense-tracker' } });
    await prisma.projectReview.create({ data: { projectId: p.id, reviewerId: anita.id, stage: 'TEACHER', decision: 'CHANGES', comment: 'Add monthly charts.' } });
    await prisma.projectSubmission.create({ data: { projectId: p.id, version: 2, title: 'Expense tracker', description: 'Now with monthly charts', link: 'https://github.com/example/expense-tracker' } });
    await prisma.projectReview.create({ data: { projectId: p.id, reviewerId: anita.id, stage: 'TEACHER', decision: 'APPROVE', comment: 'Well done.' } });
  }
}
