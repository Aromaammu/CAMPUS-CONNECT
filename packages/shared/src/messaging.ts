import { z } from 'zod';

/** PRD §12 messaging. */
export const messageSchema = z.object({
  text: z.string().trim().max(4000, 'Keep messages under 4,000 characters').optional(),
  fileId: z.string().optional(),
  replyToId: z.string().optional(),
}).refine((v) => (v.text && v.text.length) || v.fileId, { message: 'Type a message', path: ['text'] });
export const messageEditSchema = z.object({ text: z.string().trim().min(1, 'Type a message').max(4000) });
export const directSchema = z.object({ userId: z.string().min(1) });
export const groupSchema = z.object({
  title: z.string().trim().min(3, 'Name the group').max(80),
  memberIds: z.array(z.string().min(1)).min(1, 'Add at least one person').max(500),
});
export const groupMembersSchema = z.object({ add: z.array(z.string()).max(500).default([]), remove: z.array(z.string()).max(500).default([]) });
export const hideMessageSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(300) });

export const announcementSchema = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(150),
  body: z.string().trim().min(3, 'Write the announcement').max(5000),
  scope: z.enum(['ALL', 'BRANCHES', 'BATCHES']),
  branchIds: z.array(z.string()).max(500).default([]),
  batchIds: z.array(z.string()).max(500).default([]),
  audience: z.enum(['EVERYONE', 'STAFF', 'STUDENTS']).default('EVERYONE'),
}).refine((v) => v.scope !== 'BRANCHES' || v.branchIds.length, { message: 'Choose at least one branch', path: ['branchIds'] })
  .refine((v) => v.scope !== 'BATCHES' || v.batchIds.length, { message: 'Choose at least one batch', path: ['batchIds'] });
export const ANNOUNCEMENT_AUDIENCE = { EVERYONE: 'Everyone', STAFF: 'Staff only', STUDENTS: 'Students only' } as const;

export const meetingSchema = z.object({
  title: z.string().trim().min(3, 'Give the meeting a title').max(150),
  scheduledAt: z.string().datetime().optional(),
  durationMin: z.number().int().min(15).max(480).default(60),
  participantIds: z.array(z.string().min(1)).max(300).default([]),
  conversationId: z.string().optional(),
  record: z.boolean().default(false),
});
export type MeetingInput = z.infer<typeof meetingSchema>;
