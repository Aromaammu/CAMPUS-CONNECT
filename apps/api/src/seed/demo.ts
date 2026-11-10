import { PrismaClient } from '@prisma/client';
import { DEPARTMENT_TEMPLATES, DESIGNATION_TEMPLATES, ModuleKey } from '@cc/shared';
import { hashPassword } from '../modules/auth/auth.service';

export const DEMO_PASSWORD = 'Demo@1234';

export interface DemoLogin { role: string; name: string; email: string; mobile: string; note?: string }
export const DEMO_LOGINS: DemoLogin[] = [];

const BRANCHES = [
  { code: 'KOC01', name: 'Kochi – Palarivattom', city: 'Kochi', state: 'Kerala', pin: '682025' },
  { code: 'TVM01', name: 'Thiruvananthapuram – Technopark', city: 'Thiruvananthapuram', state: 'Kerala', pin: '695581' },
  { code: 'BLR01', name: 'Bengaluru – Koramangala', city: 'Bengaluru', state: 'Karnataka', pin: '560034' },
];

const FIRST = ['Arjun', 'Diya', 'Rohan', 'Meera', 'Kiran', 'Anjali', 'Vishnu', 'Sneha', 'Aditya', 'Fathima', 'Nikhil', 'Lakshmi', 'Rahul', 'Aisha', 'Gokul', 'Neha', 'Joel', 'Priya', 'Hari', 'Sara', 'Amal', 'Riya', 'Sanjay', 'Kavya', 'Abhay', 'Nimisha', 'Vivek', 'Ann', 'Tarun', 'Devika'];
const LAST = ['Nair', 'Menon', 'Pillai', 'Varghese', 'Kumar', 'Thomas', 'Joseph', 'Krishnan', 'Rao', 'Shetty', 'Iyer', 'Das'];

let mobileSeq = 9000000000;
const nextMobile = () => String(++mobileSeq);

export async function seedOrganisation(prisma: PrismaClient) {
  const hash = await hashPassword(DEMO_PASSWORD);
  DEMO_LOGINS.length = 0;
  mobileSeq = 9000000000;

  // Head-office templates
  for (const d of DEPARTMENT_TEMPLATES) await prisma.department.create({ data: { name: d } });
  const tplDepts = await prisma.department.findMany({ where: { branchId: null } });
  for (const t of DESIGNATION_TEMPLATES) {
    await prisma.designation.create({ data: { name: t.name, permissions: t.permissions, departmentId: tplDepts.find((d) => d.name === t.department)?.id } });
  }

  const user = async (kind: 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'STUDENT', name: string, email: string, role: string, extra: { mustChange?: boolean; note?: string } = {}) => {
    const mobile = nextMobile();
    const u = await prisma.user.create({ data: { kind, name, email, mobile, passwordHash: hash, mustChangePassword: extra.mustChange ?? false } });
    if (!extra.mustChange) await prisma.consent.create({ data: { userId: u.id, policyVersion: '2026-11' } });
    DEMO_LOGINS.push({ role, name, email, mobile, note: extra.note });
    return u;
  };

  await user('SUPER_ADMIN', 'Dr. Thomas Mathew', 'director@demo.cc', 'Super Admin (Director)');
  const admins: { name: string; email: string; role: string; modules: ModuleKey[] }[] = [
    { name: 'Asha Raman', email: 'academics@demo.cc', role: 'Admin: Academics + People', modules: ['academics', 'people'] },
    { name: 'Suresh Iyer', email: 'accounts@demo.cc', role: 'Head of Accounts', modules: ['accounts'] },
    { name: 'Leela George', email: 'monitoring@demo.cc', role: 'Admin: Monitoring, Communication, Help Desk', modules: ['monitoring', 'communication', 'helpdesk'] },
    { name: 'Vinod Kurian', email: 'ops@demo.cc', role: 'Admin: Branches + Settings', modules: ['branches', 'settings'] },
  ];
  for (const a of admins) {
    const u = await user('ADMIN', a.name, a.email, a.role);
    await prisma.adminModuleGrant.createMany({ data: a.modules.map((module) => ({ userId: u.id, module })) });
  }

  const branches = [];
  for (const b of BRANCHES) {
    const br = await prisma.branch.create({ data: { ...b, address: `${b.name}, ${b.city}`, phone: '+91 484 400 0000', email: `${b.code.toLowerCase()}@demo.cc`, openedOn: new Date('2023-06-01') } });
    branches.push(br);
    await prisma.room.createMany({ data: [{ branchId: br.id, name: 'Lab 1', capacity: 30 }, { branchId: br.id, name: 'Lab 2', capacity: 24 }, { branchId: br.id, name: 'Seminar Hall', capacity: 60 }] });
    await copyTemplatesToBranch(prisma, br.id);
  }
  const [koc, tvm, blr] = branches;

  const designation = (branchId: string, name: string) => prisma.designation.findFirstOrThrow({ where: { branchId, name } });
  const empSeq: Record<string, number> = {};
  const employee = async (branch: typeof koc, desig: string, name: string, email: string, role: string, extraBranches: string[] = [], opts: { mustChange?: boolean; note?: string } = {}) => {
    const d = await designation(branch.id, desig);
    const u = await user('EMPLOYEE', name, email, role, opts);
    empSeq[branch.id] = (empSeq[branch.id] ?? 0) + 1;
    await prisma.idCounter.upsert({ where: { branchId_kind_year: { branchId: branch.id, kind: 'EMP', year: 0 } }, create: { branchId: branch.id, kind: 'EMP', year: 0, last: empSeq[branch.id] }, update: { last: empSeq[branch.id] } });
    return prisma.employee.create({
      data: {
        userId: u.id, code: `EMP-${branch.code}-${String(empSeq[branch.id]).padStart(4, '0')}`, branchId: branch.id,
        designationId: d.id, departmentId: d.departmentId, joiningDate: new Date('2024-01-15'),
        extraBranches: { create: extraBranches.map((branchId) => ({ branchId })) },
      },
    });
  };

  const staff = {
    kocAdmin: await employee(koc, 'Branch Admin', 'Bindu Mohan', 'kochi.admin@demo.cc', 'Branch Admin – Kochi'),
    anita: await employee(koc, 'Senior Trainer', 'Anita Joseph', 'anita.trainer@demo.cc', 'Teacher – Kochi + Thiruvananthapuram', [tvm.id]),
    rahul: await employee(koc, 'Trainer', 'Rahul Menon', 'rahul.trainer@demo.cc', 'Teacher – Kochi'),
    kocAcc: await employee(koc, 'Accountant', 'Deepa Varghese', 'kochi.accounts@demo.cc', 'Accountant – Kochi'),
    kocCoun: await employee(koc, 'Counsellor', 'Faisal Rahman', 'kochi.counsellor@demo.cc', 'Counsellor – Kochi'),
    tvmAdmin: await employee(tvm, 'Branch Admin', 'Gopika Nair', 'tvm.admin@demo.cc', 'Branch Admin – Thiruvananthapuram'),
    sanjay: await employee(tvm, 'Trainer', 'Sanjay Pillai', 'sanjay.trainer@demo.cc', 'Teacher – Thiruvananthapuram'),
    tvmAcc: await employee(tvm, 'Accountant', 'Liji Thomas', 'tvm.accounts@demo.cc', 'Accountant – Thiruvananthapuram'),
    blrAdmin: await employee(blr, 'Branch Admin', 'Karthik Rao', 'blr.admin@demo.cc', 'Branch Admin – Bengaluru'),
    priyaT: await employee(blr, 'Trainer', 'Priya Shetty', 'priya.trainer@demo.cc', 'Teacher – Bengaluru'),
    newStaff: await employee(koc, 'Front Office', 'Neethu Paul', 'new.staff@demo.cc', 'Front Office – Kochi (first login)', [], { mustChange: true, note: 'Must set a new password on first login' }),
  };

  // Students: 24 Kochi, 10 Thiruvananthapuram, 8 Bengaluru
  const students: { id: string; branchId: string; userId: string }[] = [];
  const stuCount: Record<string, number> = {};
  const student = async (branch: typeof koc, name: string, email: string, role: string | null, opts: { dob?: string; mustChange?: boolean; note?: string } = {}) => {
    const mobile = nextMobile();
    const u = await prisma.user.create({ data: { kind: 'STUDENT', name, email, mobile, passwordHash: hash, mustChangePassword: opts.mustChange ?? false } });
    if (!opts.mustChange) await prisma.consent.create({ data: { userId: u.id, policyVersion: '2026-11' } });
    if (role) DEMO_LOGINS.push({ role, name, email, mobile, note: opts.note });
    stuCount[branch.id] = (stuCount[branch.id] ?? 0) + 1;
    await prisma.idCounter.upsert({ where: { branchId_kind_year: { branchId: branch.id, kind: 'STU', year: 2026 } }, create: { branchId: branch.id, kind: 'STU', year: 2026, last: stuCount[branch.id] }, update: { last: stuCount[branch.id] } });
    const s = await prisma.student.create({
      data: {
        userId: u.id, code: `STU-${branch.code}-26-${String(stuCount[branch.id]).padStart(4, '0')}`, branchId: branch.id,
        dob: new Date(opts.dob ?? '2002-05-10'), address: `${branch.city}, ${branch.state}`, guardianName: 'Parent / Guardian', guardianPhone: '9846000000',
      },
    });
    students.push({ id: s.id, branchId: branch.id, userId: u.id });
    return s;
  };
  const arjun = await student(koc, 'Arjun Nair', 'arjun.student@demo.cc', 'Student – Kochi (enrolled in 2 branches)');
  const diya = await student(koc, 'Diya Menon', 'diya.student@demo.cc', 'Student – Kochi');
  await student(koc, 'Kevin Mathew', 'new.student@demo.cc', 'Student – Kochi (first login, under 18)', { dob: '2009-03-02', mustChange: true, note: 'Must set a password and give guardian consent' });
  let k = 0;
  const gen = async (branch: typeof koc, n: number) => {
    for (let i = 0; i < n; i++, k++) {
      let name = `${FIRST[k % FIRST.length]} ${LAST[(k * 7) % LAST.length]}`;
      // Never repeat a demo login's name, so the owner can tell people apart.
      if (['Arjun Nair', 'Diya Menon'].includes(name)) name = `${FIRST[k % FIRST.length]} ${LAST[(k * 7 + 3) % LAST.length]}`;
      await student(branch, name, `student${k + 1}@demo.cc`, null);
    }
  };
  await gen(koc, 21);
  await gen(tvm, 10);
  await gen(blr, 8);

  await prisma.holiday.createMany({
    data: [
      { date: new Date('2026-11-14'), name: "Children's Day (institute holiday)" },
      { date: new Date('2026-12-25'), name: 'Christmas' },
      { date: new Date('2027-01-26'), name: 'Republic Day' },
    ],
  });
  await prisma.holiday.create({ data: { branchId: koc.id, date: new Date('2026-11-27'), name: 'Kochi branch annual day' } });

  return { branches: { koc, tvm, blr }, staff, students, arjun, diya };
}

/** Each new branch starts with the head-office departments and designations. */
export async function copyTemplatesToBranch(prisma: Pick<PrismaClient, 'department' | 'designation'>, branchId: string) {
  const depts = await prisma.department.findMany({ where: { branchId: null } });
  const map = new Map<string, string>();
  for (const d of depts) {
    const nd = await prisma.department.create({ data: { branchId, name: d.name } });
    map.set(d.id, nd.id);
  }
  const desigs = await prisma.designation.findMany({ where: { branchId: null } });
  for (const d of desigs) {
    await prisma.designation.create({ data: { branchId, name: d.name, permissions: d.permissions, departmentId: d.departmentId ? map.get(d.departmentId) : null } });
  }
}
