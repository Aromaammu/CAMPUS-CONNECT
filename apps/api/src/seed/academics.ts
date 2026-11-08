import { PrismaClient } from '@prisma/client';
import { planSessions } from '@cc/shared';
import type { seedOrganisation } from './demo';

type Org = Awaited<ReturnType<typeof seedOrganisation>>;

const istKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);
/** Monday of the week `weeksAgo` weeks before today (IST). */
function monday(weeksAgo: number) {
  const d = new Date(`${istKey(new Date())}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dow - 1) - weeksAgo * 7);
  return d.toISOString().slice(0, 10);
}

export const COURSES = [
  {
    code: 'PY-FS', name: 'Python Full Stack', category: 'Programming', hours: 40, fee: 3500000,
    modules: [['Python basics', 'Syntax, data types, control flow, functions'], ['OOP and modules', 'Classes, inheritance, packages, virtual environments'], ['Databases with SQL', 'PostgreSQL, joins, ORM basics'], ['Django web apps', 'Models, views, templates, forms, auth'], ['REST APIs', 'Django REST Framework, JWT'], ['Frontend with React', 'Components, state, fetching data'], ['Deployment', 'Git, Docker basics, cloud hosting'], ['Final project', 'Build and present a full-stack app']],
  },
  {
    code: 'JAVA-FS', name: 'Java Full Stack', category: 'Programming', hours: 120, fee: 6500000,
    modules: [['Core Java', 'OOP, collections, exceptions'], ['Spring Boot', 'REST, JPA, security'], ['Angular', 'Components, services, routing'], ['Final project', 'Enterprise web app']],
  },
  {
    code: 'DM-AI', name: 'Digital Marketing with AI', category: 'Marketing', hours: 60, fee: 3000000,
    modules: [['Marketing foundations', 'Funnels, personas'], ['SEO & content', 'Keyword research, AI writing tools'], ['Social & paid ads', 'Meta, Google Ads'], ['Analytics', 'GA4, dashboards']],
  },
  {
    code: 'DA-PY', name: 'Data Analytics with Python', category: 'Data', hours: 80, fee: 4500000,
    modules: [['Excel to Python', 'Pandas, NumPy'], ['Visualisation', 'Matplotlib, Power BI'], ['Statistics', 'Descriptive, inferential'], ['Capstone', 'Business case study']],
  },
];

export async function seedAcademics(prisma: PrismaClient, org: Org) {
  const { koc, tvm, blr } = org.branches;
  const courses: Record<string, string> = {};
  for (const c of COURSES) {
    const row = await prisma.course.create({
      data: {
        code: c.code, name: c.name, category: c.category, totalMinutes: c.hours * 60, defaultFeePaise: c.fee, status: 'PUBLISHED',
        description: `${c.name}: a ${c.hours}-hour hands-on programme with a final project.`,
        modules: { create: c.modules.map(([title, topics], i) => ({ position: i + 1, title, topics })) },
      },
    });
    courses[c.code] = row.id;
  }
  // A draft course only head office sees.
  await prisma.course.create({ data: { code: 'CYB-101', name: 'Cyber Security Essentials', category: 'Security', totalMinutes: 50 * 60, status: 'DRAFT', defaultFeePaise: 2800000 } });

  const holidays = (await prisma.holiday.findMany()).map((h) => ({ key: h.date.toISOString().slice(0, 10), branchId: h.branchId }));
  const now = new Date();
  const room = (branchId: string, name: string) => prisma.room.findFirstOrThrow({ where: { branchId, name } });
  const makeBatch = async (o: { branchId: string; course: string; name: string; mode: 'ONLINE' | 'OFFLINE' | 'HYBRID'; start: string; days: number[]; startTime: string; endTime: string; teacher: string; backup?: string; roomId?: string; capacity: number }) => {
    const course = COURSES.find((c) => c.code === o.course)!;
    const plan = planSessions({ startDate: o.start, days: o.days, startTime: o.startTime, endTime: o.endTime, totalMinutes: course.hours * 60, holidays: holidays.filter((h) => !h.branchId || h.branchId === o.branchId).map((h) => h.key) });
    const firstStart = plan[0]?.startsAt;
    const anyLeft = plan.some((p) => p.endsAt > now);
    return prisma.batch.create({
      data: {
        branchId: o.branchId, courseId: courses[o.course], name: o.name, mode: o.mode, startDate: new Date(o.start), days: o.days, startTime: o.startTime, endTime: o.endTime,
        roomId: o.roomId ?? null, capacity: o.capacity, autoRecord: o.mode !== 'OFFLINE',
        status: !firstStart || firstStart > now ? 'UPCOMING' : anyLeft ? 'RUNNING' : 'COMPLETED',
        teachers: { create: [{ employeeId: o.teacher, role: 'MAIN' }, ...(o.backup ? [{ employeeId: o.backup, role: 'BACKUP' }] : [])] },
        sessions: { create: plan.map((p) => ({ position: p.position, startsAt: p.startsAt, endsAt: p.endsAt, roomId: o.roomId ?? null, status: p.endsAt <= now ? 'COMPLETED' as const : 'SCHEDULED' as const })) },
      },
    });
  };

  const lab1Koc = await room(koc.id, 'Lab 1');
  const lab1Blr = await room(blr.id, 'Lab 1');
  const pyKoc = await makeBatch({ branchId: koc.id, course: 'PY-FS', name: 'Morning Batch A', mode: 'ONLINE', start: monday(2), days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '11:00', teacher: org.staff.anita.id, backup: org.staff.rahul.id, capacity: 30 });
  const javaKoc = await makeBatch({ branchId: koc.id, course: 'JAVA-FS', name: 'Evening Batch – Hybrid', mode: 'HYBRID', start: monday(-1), days: [1, 3, 5], startTime: '18:00', endTime: '20:00', teacher: org.staff.rahul.id, roomId: lab1Koc.id, capacity: 24 });
  const pyTvm = await makeBatch({ branchId: tvm.id, course: 'PY-FS', name: 'Afternoon Batch', mode: 'ONLINE', start: monday(1), days: [2, 4], startTime: '14:00', endTime: '16:00', teacher: org.staff.anita.id, backup: org.staff.sanjay.id, capacity: 30 });
  const dmBlr = await makeBatch({ branchId: blr.id, course: 'DM-AI', name: 'Weekend Batch', mode: 'OFFLINE', start: monday(3), days: [6], startTime: '10:00', endTime: '13:00', teacher: org.staff.priyaT.id, roomId: lab1Blr.id, capacity: 20 });

  const byBranch = (b: string) => org.students.filter((s) => s.branchId === b);
  const kocStudents = byBranch(koc.id).filter((s) => s.id !== org.students.find((x) => x.userId && x.id === org.arjun.id)?.id);
  const enrol = (batchId: string, ids: string[]) => prisma.enrolment.createMany({ data: ids.map((studentId) => ({ studentId, batchId, enrolledOn: new Date(Date.now() - 20 * 86400000) })), skipDuplicates: true });
  // Kochi Python: Arjun, Diya + 18 more Kochi students (not the first-login student)
  const newStudent = await prisma.student.findFirstOrThrow({ where: { user: { email: 'new.student@demo.cc' } } });
  const kocPool = kocStudents.filter((s) => s.id !== newStudent.id && s.id !== org.arjun.id && s.id !== org.diya.id);
  await enrol(pyKoc.id, [org.arjun.id, org.diya.id, ...kocPool.slice(0, 18).map((s) => s.id)]);
  await enrol(javaKoc.id, [org.diya.id, ...kocPool.slice(10, 19).map((s) => s.id)]);
  // Arjun also studies in Thiruvananthapuram (multi-branch student)
  await enrol(pyTvm.id, [org.arjun.id, ...byBranch(tvm.id).slice(0, 8).map((s) => s.id)]);
  await enrol(dmBlr.id, byBranch(blr.id).map((s) => s.id));

  await prisma.courseRequest.create({
    data: {
      branchId: koc.id, requestedById: (await prisma.user.findUniqueOrThrow({ where: { email: 'kochi.admin@demo.cc' } })).id,
      name: 'Cloud & DevOps Foundations', category: 'Cloud', totalMinutes: 45 * 60, feePaise: 3200000,
      description: 'Many Kochi students ask for AWS and DevOps after Python Full Stack.',
      syllabus: [{ title: 'Linux & networking', topics: 'Shell, SSH, DNS' }, { title: 'AWS core services', topics: 'EC2, S3, IAM' }, { title: 'CI/CD', topics: 'GitHub Actions, Docker' }],
    },
  });

  return { courses, batches: { pyKoc, javaKoc, pyTvm, dmBlr } };
}
