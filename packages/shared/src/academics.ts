import { z } from 'zod';
import { dateKeySchema, hhmmSchema } from './schemas';
import { istToUtc } from './format';

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());

export const courseModuleSchema = z.object({ title: z.string().trim().min(2, 'Enter a module title').max(150), topics: opt(z.string().trim().max(2000)) });

export const courseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Use letters, numbers and dashes, e.g. PY-FS'),
  name: z.string().trim().min(3, 'Enter the course name').max(150),
  category: opt(z.string().trim().max(60)),
  hours: z.coerce.number().min(1, 'At least 1 hour').max(2000),
  description: opt(z.string().trim().max(3000)),
  defaultFee: z.coerce.number().min(0).max(10000000).default(0),
  feeLocked: z.boolean().default(false),
  allBranches: z.boolean().default(true),
  branchIds: z.array(z.string()).default([]),
  modules: z.array(courseModuleSchema).max(200).default([]),
});
export type CourseInput = z.infer<typeof courseSchema>;

export const courseRequestSchema = z.object({
  branchId: z.string().min(1, 'Choose a branch'),
  name: z.string().trim().min(3, 'Enter the course name').max(150),
  category: opt(z.string().trim().max(60)),
  hours: z.coerce.number().min(1, 'At least 1 hour').max(2000),
  description: opt(z.string().trim().max(3000)),
  fee: z.coerce.number().min(0).max(10000000).default(0),
  syllabus: z.array(courseModuleSchema).max(200).default([]),
});

export const courseDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'SEND_BACK']),
  note: opt(z.string().trim().max(1000)),
  code: opt(z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/, 'Use letters, numbers and dashes')),
  shareAll: z.boolean().default(false),
}).refine((v) => v.decision === 'APPROVE' || (v.note && v.note.length >= 3), { message: 'Please give a reason', path: ['note'] })
  .refine((v) => v.decision !== 'APPROVE' || !!v.code, { message: 'Give the course a code', path: ['code'] });

export const batchSchema = z.object({
  branchId: z.string().min(1, 'Choose a branch'),
  courseId: z.string().min(1, 'Choose a course'),
  name: z.string().trim().min(2, 'Enter a batch name').max(80),
  mode: z.enum(['ONLINE', 'OFFLINE', 'HYBRID']),
  startDate: dateKeySchema,
  days: z.array(z.number().int().min(0).max(6)).min(1, 'Choose at least one day'),
  startTime: hhmmSchema,
  endTime: hhmmSchema,
  roomId: opt(z.string()),
  capacity: z.coerce.number().int().min(1).max(500),
  teacherId: z.string().min(1, 'Choose the main teacher'),
  backupTeacherId: opt(z.string()),
  autoRecord: z.boolean().default(true),
  checkinRequired: z.boolean().default(false),
  fee: opt(z.coerce.number().min(0).max(10000000)),
})
  .refine((v) => v.endTime > v.startTime, { message: 'The class must end after it starts', path: ['endTime'] })
  .refine((v) => v.mode === 'ONLINE' || !!v.roomId, { message: 'Offline and hybrid batches need a room', path: ['roomId'] });
export type BatchInput = z.infer<typeof batchSchema>;

export const batchUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
  capacity: z.coerce.number().int().min(1).max(500),
  roomId: opt(z.string()),
  teacherId: z.string().min(1, 'Choose the main teacher'),
  backupTeacherId: opt(z.string()),
  autoRecord: z.boolean(),
  checkinRequired: z.boolean(),
  fee: opt(z.coerce.number().min(0).max(10000000)),
});

export const rescheduleSchema = z.object({
  date: dateKeySchema,
  startTime: hhmmSchema,
  endTime: hhmmSchema,
  roomId: opt(z.string()),
  note: opt(z.string().trim().max(300)),
}).refine((v) => v.endTime > v.startTime, { message: 'The class must end after it starts', path: ['endTime'] });

export const cancelSessionSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(300), addMakeUp: z.boolean().default(true) });
export const substituteSchema = z.object({ teacherId: opt(z.string()) });
export const enrolSchema = z.object({ studentIds: z.array(z.string()).min(1, 'Choose at least one student').max(200) });
export const enrolmentActionSchema = z.object({
  action: z.enum(['HOLD', 'RESUME', 'DROP', 'MOVE']),
  note: opt(z.string().trim().max(300)),
  toBatchId: opt(z.string()),
}).refine((v) => v.action !== 'DROP' || (v.note && v.note.length >= 3), { message: 'Please give a reason', path: ['note'] })
  .refine((v) => v.action !== 'MOVE' || !!v.toBatchId, { message: 'Choose the new batch', path: ['toBatchId'] });

export interface PlannedSession { position: number; date: string; startsAt: Date; endsAt: Date }

/**
 * Builds the session list for a batch (PRD §6.2): the chosen weekdays from the start date,
 * skipping holidays, until the course hours are delivered.
 */
export function planSessions(opts: { startDate: string; days: number[]; startTime: string; endTime: string; totalMinutes: number; holidays: string[]; startPosition?: number; maxSessions?: number }): PlannedSession[] {
  const [sh, sm] = opts.startTime.split(':').map(Number);
  const [eh, em] = opts.endTime.split(':').map(Number);
  const per = eh * 60 + em - (sh * 60 + sm);
  if (per <= 0 || !opts.days.length || opts.totalMinutes <= 0) return [];
  const holidays = new Set(opts.holidays);
  const out: PlannedSession[] = [];
  let minutes = 0;
  const d = new Date(`${opts.startDate}T00:00:00Z`);
  const max = opts.maxSessions ?? 1000;
  for (let guard = 0; minutes < opts.totalMinutes && out.length < max && guard < 3660; guard++) {
    const key = d.toISOString().slice(0, 10);
    if (opts.days.includes(d.getUTCDay()) && !holidays.has(key)) {
      out.push({ position: (opts.startPosition ?? 1) + out.length, date: key, startsAt: istToUtc(key, opts.startTime), endsAt: istToUtc(key, opts.endTime) });
      minutes += per;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Do two time ranges overlap? */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && bStart < aEnd;
}
