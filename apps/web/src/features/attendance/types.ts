import type { AttStatus, BATCH_MODES, SESSION_STATUS } from '@cc/shared';

export interface RosterRow {
  studentId: string; userId: string; name: string; code: string;
  status: AttStatus | null; source: string | null; saved: boolean;
  seconds: number; percent: number; firstJoinAt: string | null; inRoomNow: boolean; inRoom: boolean;
  checkins: { opened: number; answered: number }; reason: string | null;
}

export interface RosterResult {
  session: { id: string; position: number; startsAt: string; endsAt: string; status: keyof typeof SESSION_STATUS; liveStartedAt: string | null; liveEndedAt: string | null; topic: string | null; finalized: boolean };
  batch: { id: string; name: string; mode: keyof typeof BATCH_MODES; course: string; branch: { id: string; code: string; name: string }; checkinRequired: boolean };
  locked: boolean; canEdit: boolean; isTeacher: boolean; lockHours: number;
  rows: RosterRow[];
  checkins: { id: string; openedAt: string; closesAt: string; answered: number; open: boolean }[];
}

export interface AttRequestRow {
  id: string; reason: string; note: string | null; attachmentId: string | null; status: 'PENDING' | 'ESCALATED' | 'APPROVED' | 'REJECTED';
  grantedStatus: AttStatus | null; decisionNote: string | null; createdAt: string; decidedAt: string | null; escalatedAt: string | null; canDecide: boolean;
  student: { id: string; code: string; user: { id: string; name: string } };
  session: { id: string; position: number; startsAt: string; endsAt: string; batch: { id: string; name: string; branch: { code: string }; course: { name: string } } };
}

export const STATUS_TONE: Record<AttStatus, 'ok' | 'warn' | 'bad' | 'info'> = { PRESENT: 'ok', LATE: 'warn', ABSENT: 'bad', EXCUSED: 'info' };
export const formatMinutes = (secs: number) => (secs < 60 ? `${secs}s` : `${Math.round(secs / 60)} min`);
