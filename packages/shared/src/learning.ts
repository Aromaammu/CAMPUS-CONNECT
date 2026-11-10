import { z } from 'zod';

const optText = (max: number) => z.string().trim().max(max).optional().or(z.literal('').transform(() => undefined));

/** PRD §9.1: a link (or file, sent separately) for a batch, a class or a course module, shareable with other batches of the course. */
export const materialSchema = z.object({
  title: z.string().trim().min(2, 'Give it a title').max(200),
  batchIds: z.array(z.string().min(1)).min(1, 'Choose at least one batch').max(50),
  sessionId: z.string().optional(),
  moduleId: z.string().optional(),
  url: z.string().trim().url('Enter a full link starting with https://').max(1000).refine((u) => /^https?:\/\//i.test(u), 'Enter a full link starting with https://').optional(),
});
export type MaterialInput = z.infer<typeof materialSchema>;
export const materialShareSchema = z.object({ batchIds: z.array(z.string().min(1)).min(1).max(50) });

/** PRD §9.2: quick grid of 1–5 marks per class. */
export const performanceSchema = z.object({
  marks: z.array(z.object({
    studentId: z.string().min(1),
    mark: z.number().int().min(1, 'Marks are 1 to 5').max(5, 'Marks are 1 to 5').nullable(),
    remark: optText(300),
  })).min(1).max(300),
});
export type PerformanceInput = z.infer<typeof performanceSchema>;
export const PERFORMANCE_LABELS: Record<number, string> = { 1: 'Needs help', 2: 'Below average', 3: 'Average', 4: 'Good', 5: 'Excellent' };

/** PRD §9.3 feedback. */
export const FEEDBACK_AREAS = ['understanding', 'practice', 'participation', 'punctuality'] as const;
export const FEEDBACK_AREA_LABELS: Record<(typeof FEEDBACK_AREAS)[number], string> = { understanding: 'Understanding', practice: 'Practice', participation: 'Participation', punctuality: 'Punctuality' };
export const COURSE_FEEDBACK_AREAS = ['teaching', 'content', 'pace', 'support'] as const;
export const COURSE_FEEDBACK_AREA_LABELS: Record<(typeof COURSE_FEEDBACK_AREAS)[number], string> = { teaching: 'Teaching', content: 'Course content', pace: 'Pace', support: 'Support from the branch' };

const rating = z.number().int().min(1, 'Choose 1 to 5 stars').max(5);
export const teacherFeedbackSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('TEACHER_NOTE'), studentId: z.string().min(1), batchId: z.string().min(1), comment: z.string().trim().min(3, 'Write your feedback').max(2000) }),
  z.object({
    kind: z.enum(['TEACHER_MID', 'TEACHER_END']), studentId: z.string().min(1), batchId: z.string().min(1),
    ratings: z.object(Object.fromEntries(FEEDBACK_AREAS.map((a) => [a, rating])) as Record<(typeof FEEDBACK_AREAS)[number], typeof rating>),
    comment: optText(2000),
  }),
]);
export type TeacherFeedbackInput = z.infer<typeof teacherFeedbackSchema>;
export const sessionRatingSchema = z.object({ rating, comment: optText(500) });
export const courseFeedbackSchema = z.object({
  batchId: z.string().min(1),
  ratings: z.object(Object.fromEntries(COURSE_FEEDBACK_AREAS.map((a) => [a, rating])) as Record<(typeof COURSE_FEEDBACK_AREAS)[number], typeof rating>),
  comment: optText(2000),
});

/** PRD §9.4 final project. */
export const projectSubmitSchema = z.object({
  title: z.string().trim().min(3, 'Give your project a title').max(200),
  description: optText(5000),
  link: z.string().trim().url('Enter a full link, e.g. https://github.com/you/project').max(1000).optional().or(z.literal('').transform(() => undefined)),
  fileIds: z.array(z.string()).max(10).default([]),
}).refine((v) => v.link || v.fileIds.length, { message: 'Add a link or upload at least one file', path: ['link'] });
export const projectReviewSchema = z.object({
  decision: z.enum(['APPROVE', 'CHANGES', 'REJECT', 'SEND_BACK']),
  comment: optText(3000),
}).refine((v) => v.decision === 'APPROVE' || (v.comment && v.comment.length >= 3), { message: 'Tell the student what to change', path: ['comment'] });

/** Running average of 1–5 marks, one decimal. */
export function averageMark(marks: number[]): number | null {
  if (!marks.length) return null;
  return Math.round((marks.reduce((a, b) => a + b, 0) / marks.length) * 10) / 10;
}
