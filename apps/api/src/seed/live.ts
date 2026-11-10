import { PrismaClient } from '@prisma/client';

const istHHMM = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
const istKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

export const DEMO_CLASS_BATCH = 'Live Demo Class';

/**
 * A Kochi online class that is open right now (started 5 minutes ago, runs 3 hours), so the owner and
 * the browser tests can try the class room at any time. Calling it again moves the class to "now" and clears it.
 */
export async function ensureDemoClass(prisma: PrismaClient, now = new Date()) {
  const koc = await prisma.branch.findUniqueOrThrow({ where: { code: 'KOC01' } });
  const course = await prisma.course.findUniqueOrThrow({ where: { code: 'PY-FS' } });
  const emp = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, include: { employee: true } })).employee!;
  const stu = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true } })).student!;
  const anita = await emp('anita.trainer@demo.cc');
  const rahul = await emp('rahul.trainer@demo.cc');
  const startsAt = new Date(now.getTime() - 5 * 60_000);
  const endsAt = new Date(now.getTime() + 3 * 60 * 60_000);

  let batch = await prisma.batch.findUnique({ where: { branchId_name: { branchId: koc.id, name: DEMO_CLASS_BATCH } } });
  if (!batch) {
    const named = [await stu('arjun.student@demo.cc'), await stu('diya.student@demo.cc')];
    const others = await prisma.student.findMany({ where: { branchId: koc.id, id: { notIn: named.map((s) => s.id) }, user: { mustChangePassword: false, name: { notIn: ['Arjun Nair', 'Diya Menon'] } } }, orderBy: { code: 'asc' }, take: 4 });
    batch = await prisma.batch.create({
      data: {
        branchId: koc.id, courseId: course.id, name: DEMO_CLASS_BATCH, mode: 'ONLINE', startDate: new Date(istKey(startsAt)), days: [0, 1, 2, 3, 4, 5, 6],
        startTime: istHHMM(startsAt), endTime: istHHMM(endsAt), capacity: 30, status: 'RUNNING', autoRecord: true,
        teachers: { create: [{ employeeId: anita.id, role: 'MAIN' }, { employeeId: rahul.id, role: 'BACKUP' }] },
        enrolments: { create: [...named, ...others].map((s) => ({ studentId: s.id, enrolledOn: new Date(now.getTime() - 7 * 86400000) })) },
      },
    });
  } else {
    await prisma.batch.update({ where: { id: batch.id }, data: { status: 'RUNNING', startDate: new Date(istKey(startsAt)), startTime: istHHMM(startsAt), endTime: istHHMM(endsAt) } });
  }
  const existing = await prisma.session.findFirst({ where: { batchId: batch.id, position: 1 } });
  const fresh = {
    startsAt, endsAt, status: 'SCHEDULED' as const, liveStartedAt: null, liveEndedAt: null, teacherJoinedAt: null, attendanceFinalizedAt: null, cancelReason: null,
    chatDisabled: false, locked: false, micAllowed: true, camAllowed: true, shareUserIds: [], removedUserIds: [], topic: 'Practice class: try the class room',
  };
  const session = existing
    ? await prisma.session.update({ where: { id: existing.id }, data: fresh })
    : await prisma.session.create({ data: { batchId: batch.id, position: 1, ...fresh } });
  await prisma.presenceInterval.deleteMany({ where: { sessionId: session.id } });
  await prisma.classChatMessage.deleteMany({ where: { sessionId: session.id } });
  await prisma.sessionGuest.deleteMany({ where: { sessionId: session.id } });
  await prisma.attendance.deleteMany({ where: { sessionId: session.id } });
  await prisma.attendanceRequest.deleteMany({ where: { sessionId: session.id } });
  await prisma.checkinWindow.deleteMany({ where: { sessionId: session.id } });
  return { batchId: batch.id, sessionId: session.id };
}
