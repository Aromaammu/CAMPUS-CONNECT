import { PrismaClient } from '@prisma/client';

/** Phase 8 demo tickets: an open one from Arjun, a resolved one from Diya, an old one in Thiruvananthapuram past its deadline. */
export async function seedHelpdesk(prisma: PrismaClient, now = new Date()) {
  const user = (email: string) => prisma.user.findUniqueOrThrow({ where: { email }, include: { student: true, employee: true } });
  // Same running number the app uses (ticket numbers do not restart each year).
  const next = async (branchId: string, code: string) => {
    const rows = await prisma.$queryRaw<{ last: number }[]>`
      INSERT INTO "IdCounter" ("branchId", "kind", "year", "last") VALUES (${branchId}, 'TKT', 0, 1)
      ON CONFLICT ("branchId", "kind", "year") DO UPDATE SET "last" = "IdCounter"."last" + 1 RETURNING "last"`;
    return `TKT-${code}-${String(Number(rows[0].last)).padStart(6, '0')}`;
  };
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
  const [arjun, diya, bindu] = await Promise.all([user('arjun.student@demo.cc'), user('diya.student@demo.cc'), user('kochi.admin@demo.cc')]);
  const koc = await prisma.branch.findUniqueOrThrow({ where: { code: 'KOC01' } });
  const tvm = await prisma.branch.findUniqueOrThrow({ where: { code: 'TVM01' } });

  await prisma.ticket.create({ data: {
    number: await next(koc.id, koc.code), branchId: koc.id, raisedById: arjun.id, category: 'TECHNICAL', subject: 'Microphone not working in the class room', createdAt: ago(3), updatedAt: ago(3),
    messages: { create: { authorId: arjun.id, body: 'When I join the class from my laptop, others cannot hear me. Chrome on Windows.', createdAt: ago(3) } },
  } });
  await prisma.ticket.create({ data: {
    number: await next(koc.id, koc.code), branchId: koc.id, raisedById: diya.id, category: 'CERTIFICATE', subject: 'Course completion certificate', status: 'RESOLVED',
    assigneeId: bindu.employee!.id, firstResponseAt: ago(40), resolvedAt: ago(30), createdAt: ago(48), updatedAt: ago(30),
    messages: { create: [
      { authorId: diya.id, body: 'When will I get my certificate for the Python course?', createdAt: ago(48) },
      { authorId: bindu.id, body: 'Certificates are given after the final project is approved. Yours will be ready on Friday.', createdAt: ago(40) },
    ] },
  } });
  const tvmStudent = await prisma.student.findFirst({ where: { branchId: tvm.id, user: { mustChangePassword: false } } });
  if (tvmStudent) {
    await prisma.ticket.create({ data: {
      number: await next(tvm.id, tvm.code), branchId: tvm.id, raisedById: tvmStudent.userId, category: 'FEES', subject: 'Receipt not received', createdAt: ago(24 * 5), updatedAt: ago(24 * 5),
      messages: { create: { authorId: tvmStudent.userId, body: 'I paid by UPI last week but have not received my receipt.', createdAt: ago(24 * 5) } },
    } });
  }
}
