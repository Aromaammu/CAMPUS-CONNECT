import { AttendanceStatus, PrismaClient } from '@prisma/client';

/**
 * Attendance for classes that already happened, so reports and percentages have something to show.
 * Most students attend; one Kochi student attends rarely (low-attendance alert demo);
 * Arjun missed his most recent Morning Batch A class (attendance request demo).
 */
export async function seedAttendance(prisma: PrismaClient, now = new Date()) {
  const sessions = await prisma.session.findMany({
    where: { endsAt: { lt: now }, status: 'COMPLETED', batch: { name: { not: 'Live Demo Class' } } },
    include: { batch: { select: { id: true, mode: true, name: true, enrolments: { where: { status: 'ACTIVE' }, select: { studentId: true, student: { select: { user: { select: { email: true } } } } } } } } },
    orderBy: { startsAt: 'asc' },
  });
  const arjun = await prisma.student.findFirstOrThrow({ where: { user: { email: 'arjun.student@demo.cc' } } });
  const morning = sessions.filter((s) => s.batch.name === 'Morning Batch A');
  const arjunMissed = morning[morning.length - 1]?.id;
  const kocMorning = await prisma.batch.findFirst({ where: { name: 'Morning Batch A' }, include: { enrolments: { orderBy: { studentId: 'asc' }, take: 6 } } });
  const lowStudent = kocMorning?.enrolments.find((e) => e.studentId !== arjun.id)?.studentId;

  let n = 0;
  for (const s of sessions) {
    const online = s.batch.mode !== 'OFFLINE';
    const duration = Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000);
    await prisma.session.update({
      where: { id: s.id },
      data: online ? { liveStartedAt: s.startsAt, liveEndedAt: s.endsAt, teacherJoinedAt: new Date(s.startsAt.getTime() - 3 * 60_000), attendanceFinalizedAt: s.endsAt } : { attendanceFinalizedAt: s.endsAt },
    });
    for (const e of s.batch.enrolments) {
      n++;
      const r = (n * 37 + s.position * 11) % 100;
      let status: AttendanceStatus = r < 80 ? 'PRESENT' : r < 88 ? 'LATE' : r < 98 ? 'ABSENT' : 'EXCUSED';
      if (e.studentId === lowStudent) status = r < 45 ? 'PRESENT' : 'ABSENT';
      if (e.studentId === arjun.id) status = s.id === arjunMissed ? 'ABSENT' : r < 92 ? 'PRESENT' : 'LATE';
      const attended = status === 'PRESENT' ? duration - (r % 7) * 60 : status === 'LATE' ? duration - 15 * 60 : status === 'ABSENT' ? (r % 3) * 600 : 0;
      await prisma.attendance.create({
        data: {
          sessionId: s.id, studentId: e.studentId, status,
          source: status === 'EXCUSED' ? 'MANUAL' : online ? 'AUTO' : 'ROSTER',
          attendedSeconds: online ? Math.max(0, attended) : 0,
          firstJoinAt: online && status !== 'ABSENT' ? new Date(s.startsAt.getTime() + (status === 'LATE' ? 15 : r % 4) * 60_000) : null,
          inRoom: !online,
          reason: status === 'EXCUSED' ? 'Medical leave' : status === 'LATE' && online ? 'Joined 15 minutes late' : status === 'ABSENT' && online ? (attended ? `In class for ${Math.round((attended / duration) * 100)}% of the time` : 'Did not join') : null,
        },
      });
    }
  }
}
