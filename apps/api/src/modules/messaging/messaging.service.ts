import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SessionUser, can } from '@cc/shared';
import { PrismaService } from '../../common/prisma.service';

type Conv = Prisma.ConversationGetPayload<{ include: { members: true; batch: { include: { teachers: { include: { employee: true } } } } } }>;

/** PRD §12 rules: who may talk to whom, who may read and post where. */
@Injectable()
export class MessagingService {
  constructor(private prisma: PrismaService) {}

  async userInfo(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: { id: true, kind: true, status: true, name: true, student: { select: { id: true, branchId: true, enrolments: { where: { status: { in: ['ACTIVE', 'ON_HOLD', 'COMPLETED'] } }, select: { batchId: true, batch: { select: { branchId: true } } } } } }, employee: { select: { id: true, branchId: true, extraBranches: { select: { branchId: true } } } } },
    });
  }

  /** Student ↔ their teachers and branch staff; staff ↔ staff anywhere; never student ↔ student. */
  async canDirect(me: SessionUser, otherId: string) {
    if (otherId === me.id) return false;
    const other = await this.userInfo(otherId);
    if (!other || other.status !== 'ACTIVE') return false;
    const meStudent = me.kind === 'STUDENT';
    const otherStudent = other.kind === 'STUDENT';
    if (meStudent && otherStudent) return false;
    if (!meStudent && !otherStudent) return true;
    // One student, one staff member.
    const staff = meStudent ? other : await this.userInfo(me.id);
    const student = meStudent ? await this.userInfo(me.id) : other;
    if (!staff || !student?.student) return false;
    if (staff.kind === 'SUPER_ADMIN' || staff.kind === 'ADMIN') return true;
    const emp = staff.employee;
    if (!emp) return false;
    const staffBranches = new Set([emp.branchId, ...emp.extraBranches.map((b) => b.branchId)]);
    const studentBranches = new Set([student.student.branchId, ...student.student.enrolments.map((e) => e.batch.branchId)]);
    if ([...studentBranches].some((b) => staffBranches.has(b))) return true;
    const teaches = await this.prisma.batchTeacher.count({ where: { employeeId: emp.id, batchId: { in: student.student.enrolments.map((e) => e.batchId) } } });
    return teaches > 0;
  }

  /** Makes sure the user's batch groups exist and that they are in them (PRD §12: created automatically per batch). */
  async syncBatchGroups(user: SessionUser) {
    const batches = await this.prisma.batch.findMany({
      where: {
        status: { not: 'CANCELLED' },
        OR: [
          ...(user.employeeId ? [{ teachers: { some: { employeeId: user.employeeId } } }] : []),
          ...(user.studentId ? [{ enrolments: { some: { studentId: user.studentId, status: { in: ['ACTIVE' as const, 'COMPLETED' as const] } } } }] : []),
        ],
      },
      include: { branch: { select: { code: true } } },
    });
    if (!user.employeeId && !user.studentId) return;
    for (const b of batches) {
      const conv = await this.prisma.conversation.upsert({
        where: { batchId: b.id },
        create: { kind: 'BATCH', batchId: b.id, title: `${b.name} · ${b.branch.code}`, involvesStudent: true, announcementsOnly: b.groupAnnounceOnly },
        update: {},
      });
      const teacher = !!user.employeeId && (await this.prisma.batchTeacher.count({ where: { batchId: b.id, employeeId: user.employeeId } })) > 0;
      await this.prisma.conversationMember.upsert({
        where: { conversationId_userId: { conversationId: conv.id, userId: user.id } },
        create: { conversationId: conv.id, userId: user.id, role: teacher ? 'ADMIN' : 'MEMBER' },
        update: { role: teacher ? 'ADMIN' : 'MEMBER' },
      });
    }
  }

  async load(id: string): Promise<Conv> {
    const c = await this.prisma.conversation.findUnique({ where: { id }, include: { members: true, batch: { include: { teachers: { include: { employee: true } } } } } });
    if (!c) throw new NotFoundException('Conversation not found');
    return c;
  }

  /** Still allowed in a batch group: a current teacher, or a student whose place is active or completed. */
  private async stillInBatch(user: SessionUser, c: Conv) {
    if (c.kind !== 'BATCH' || !c.batch) return true;
    if (user.employeeId && c.batch.teachers.some((t) => t.employeeId === user.employeeId)) return true;
    if (!user.studentId) return false;
    const e = await this.prisma.enrolment.findUnique({ where: { studentId_batchId: { studentId: user.studentId, batchId: c.batch.id } } });
    return !!e && ['ACTIVE', 'COMPLETED'].includes(e.status);
  }

  /** Moderators: Communication admins everywhere, Branch Admins for chats with students of their branch. */
  async canModerate(user: SessionUser, c: Conv) {
    if (!c.involvesStudent || !user.permissions.includes('moderation.review')) return false;
    if (user.branchIds === null) return true;
    const students = await this.prisma.student.findMany({ where: { userId: { in: c.members.map((m) => m.userId) } }, select: { branchId: true } });
    const branches = c.batch ? [c.batch.branchId, ...students.map((s) => s.branchId)] : students.map((s) => s.branchId);
    return branches.some((b) => can(user, 'moderation.review', b));
  }

  /** Read access: members (still eligible) or moderators. */
  async assertRead(user: SessionUser, c: Conv) {
    const member = c.members.find((m) => m.userId === user.id);
    if (member && (await this.stillInBatch(user, c))) return { member, moderator: await this.canModerate(user, c) };
    if (await this.canModerate(user, c)) return { member: null, moderator: true };
    throw new ForbiddenException('You are not in this conversation');
  }

  async assertPost(user: SessionUser, c: Conv) {
    const r = await this.assertRead(user, c);
    if (!r.member) throw new ForbiddenException('Moderators can read but not post here');
    if (c.announcementsOnly && r.member.role === 'MEMBER') throw new ForbiddenException('Only teachers can post in this group');
    return r.member;
  }
}
