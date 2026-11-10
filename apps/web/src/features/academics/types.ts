import type { BATCH_MODES, BATCH_STATUS, ENROLMENT_STATUS, SESSION_STATUS } from '@cc/shared';

export interface BatchRow {
  id: string; branchId: string; courseId: string; name: string; mode: keyof typeof BATCH_MODES; startDate: string; days: number[]; startTime: string; endTime: string;
  roomId: string | null; capacity: number; status: keyof typeof BATCH_STATUS; autoRecord: boolean; checkinRequired: boolean; feePaise: number | null; projectsOpen: boolean;
  branch: { id: string; code: string; name: string };
  course: { id: string; code: string; name: string; totalMinutes: number; defaultFeePaise: number; feeLocked: boolean };
  room: { id: string; name: string; capacity: number } | null;
  teachers: { role: 'MAIN' | 'BACKUP'; employeeId: string; employee: { id: string; code: string; user: { id: string; name: string } } }[];
  _count: { enrolments: number; sessions: number };
  nextSession?: { startsAt: string; status: string } | null;
}

export interface BatchDetail extends BatchRow {
  hours: { deliveredMinutes: number; scheduledMinutes: number };
  viewerRole: 'student' | 'staff' | 'teacher';
  canManage: boolean; canEnrol: boolean; canTeach: boolean; isTeacher: boolean;
}

export interface SessionRow {
  id: string; batchId: string; position: number; startsAt: string; endsAt: string; status: keyof typeof SESSION_STATUS; topic: string | null; note: string | null; cancelReason: string | null;
  teacherId: string | null; teacher: { id: string; user: { name: string } } | null; room: { name: string } | null; liveStartedAt?: string | null;
}

export interface EnrolmentRow {
  id: string; studentId: string; batchId: string; status: keyof typeof ENROLMENT_STATUS; statusNote: string | null; enrolledOn: string;
  student: { id: string; code: string; branchId: string; user: { id: string; name: string; email: string | null; mobile: string | null }; branch: { code: string } };
}

export const mainTeacher = (b: Pick<BatchRow, 'teachers'>) => b.teachers.find((t) => t.role === 'MAIN')?.employee;
export const backupTeacher = (b: Pick<BatchRow, 'teachers'>) => b.teachers.find((t) => t.role === 'BACKUP')?.employee;
