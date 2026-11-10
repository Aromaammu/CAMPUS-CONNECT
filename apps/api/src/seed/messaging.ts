import { PrismaClient } from '@prisma/client';

/** Phase 6 demo data: a chat between Arjun and Anita, a batch group post, a staff group, an announcement and a planned meeting. */
export async function seedMessaging(prisma: PrismaClient, now = new Date()) {
  const u = async (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
  const [arjun, anita, rahul, bindu, leela] = await Promise.all(['arjun.student@demo.cc', 'anita.trainer@demo.cc', 'rahul.trainer@demo.cc', 'kochi.admin@demo.cc', 'monitoring@demo.cc'].map(u));
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  const direct = await prisma.conversation.create({
    data: { kind: 'DIRECT', directKey: [arjun.id, anita.id].sort().join(':'), createdById: arjun.id, involvesStudent: true, lastMessageAt: ago(30), members: { create: [{ userId: arjun.id, lastReadAt: ago(30) }, { userId: anita.id, lastReadAt: ago(40) }] } },
  });
  await prisma.message.createMany({ data: [
    { conversationId: direct.id, senderId: arjun.id, text: 'Good morning Ma\'am. I could not finish the Django forms exercise.', createdAt: ago(60) },
    { conversationId: direct.id, senderId: anita.id, text: 'No problem, Arjun. Look at the form validation part of the materials and try again.', createdAt: ago(40) },
    { conversationId: direct.id, senderId: arjun.id, text: 'Thank you! Will do it today.', createdAt: ago(30) },
  ] });

  const morning = await prisma.batch.findFirstOrThrow({ where: { name: 'Morning Batch A' }, include: { branch: true, teachers: { include: { employee: true } }, enrolments: { where: { status: 'ACTIVE' }, include: { student: true } } } });
  const group = await prisma.conversation.create({
    data: {
      kind: 'BATCH', batchId: morning.id, title: `${morning.name} · ${morning.branch.code}`, involvesStudent: true, lastMessageAt: ago(120),
      members: { create: [...morning.teachers.map((t) => ({ userId: t.employee.userId, role: 'ADMIN' })), ...morning.enrolments.map((e) => ({ userId: e.student.userId }))] },
    },
  });
  await prisma.message.create({ data: { conversationId: group.id, senderId: anita.id, text: 'Reminder: bring your project ideas to Friday\'s class. We will pick final projects together.', createdAt: ago(120) } });

  const staff = await prisma.conversation.create({
    data: { kind: 'GROUP', title: 'KOC01 Trainers', createdById: bindu.id, lastMessageAt: ago(200), members: { create: [{ userId: bindu.id, role: 'OWNER' }, { userId: anita.id }, { userId: rahul.id }] } },
  });
  await prisma.message.create({ data: { conversationId: staff.id, senderId: bindu.id, text: 'Lab 1 projector is fixed. Please report any issue here.', createdAt: ago(200) } });

  await prisma.announcement.create({ data: { authorId: leela.id, title: 'Welcome to Campus Connect', body: 'Classes, attendance, materials and messages are now in one place. Contact your branch if you need help.', scope: 'ALL', createdAt: ago(24 * 60) } });

  const tomorrow = new Date(now.getTime() + 24 * 3600_000);
  tomorrow.setUTCHours(10, 30, 0, 0); // 4 pm IST
  await prisma.meeting.create({ data: { title: 'Monthly trainers meeting', hostId: bindu.id, scheduledAt: tomorrow, durationMin: 45, participants: { create: [{ userId: anita.id }, { userId: rahul.id }] } } });
}
