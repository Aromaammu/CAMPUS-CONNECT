import { z } from 'zod';

/** PRD §15: every notification, who gets it, and whether people may turn email/push off. */
export const NOTIFICATION_TYPES = {
  N1: { label: 'Account created', who: 'New user', channels: 'Email, SMS', essential: true },
  N2: { label: 'Password reset / login code', who: 'User', channels: 'Email or SMS', essential: true },
  N3: { label: 'Class starts in 15 minutes', who: 'Students, teacher', channels: 'Push, in-app', essential: false },
  N4: { label: 'Class started', who: 'Students', channels: 'Push, in-app', essential: false },
  N5: { label: 'Class cancelled, moved or new teacher', who: 'Students, teacher', channels: 'Push, in-app, email, SMS', essential: true },
  N6: { label: 'Attendance requests', who: 'Teacher, student, Branch Admin', channels: 'Push, in-app, email', essential: false },
  N7: { label: 'Low attendance', who: 'Student, Branch Admin', channels: 'In-app, email', essential: false },
  N8: { label: 'New material', who: 'Students', channels: 'Push, in-app', essential: false },
  N9: { label: 'New recording', who: 'Students', channels: 'In-app', essential: false },
  N10: { label: 'Feedback received', who: 'Student', channels: 'In-app, push', essential: false },
  N11: { label: 'Final project updates', who: 'Teacher, student, Branch Admin', channels: 'In-app, push, email', essential: false },
  N12: { label: 'Fee due and overdue', who: 'Student', channels: 'Email, SMS, in-app', essential: true },
  N13: { label: 'Payment received', who: 'Student', channels: 'Email, SMS', essential: true },
  N14: { label: 'Voids and discounts to approve', who: 'Head of Accounts', channels: 'In-app, email', essential: false },
  N15: { label: 'Course requests', who: 'Academics Admin, Branch Admin', channels: 'In-app, email', essential: false },
  N16: { label: 'New message', who: 'Recipient', channels: 'Push, in-app', essential: false },
  N17: { label: 'Help desk tickets', who: 'Branch staff, student, Help Desk Admin', channels: 'In-app, email', essential: false },
  N18: { label: 'Announcements', who: 'Audience', channels: 'In-app, push', essential: false },
  N19: { label: 'Weekly network summary', who: 'Super Admin, Admins', channels: 'Email', essential: false },
  MEETING: { label: 'Staff meeting invitations', who: 'Invited staff', channels: 'In-app, push, email', essential: false },
} as const;
export type NotificationType = keyof typeof NOTIFICATION_TYPES;
export const NOTIFICATION_KEYS = Object.keys(NOTIFICATION_TYPES) as NotificationType[];

export const notificationPrefsSchema = z.object({
  prefs: z.array(z.object({ type: z.string(), email: z.boolean(), push: z.boolean() })).max(50),
});
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({ p256dh: z.string().min(10).max(500), auth: z.string().min(5).max(200) }),
});

/** Editable wording (PRD §15). Placeholders: {name} {title} {body} {link}. */
export const TEMPLATE_PLACEHOLDERS = ['{name}', '{title}', '{body}', '{link}'] as const;
export const DEFAULT_TEMPLATE = {
  subject: '{title}',
  body: 'Hello {name},\n\n{title}\n{body}\n\nOpen: {link}',
  smsBody: '{title}: {body}',
};
export const templateSchema = z.object({
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(3, 'Write the email').max(5000),
  smsBody: z.string().trim().max(300).optional(),
  smsTemplateId: z.string().trim().max(50).optional(),
});

export function fillTemplate(t: string, v: { name: string; title: string; body?: string | null; link?: string | null }) {
  return t.replace(/\{name\}/g, v.name).replace(/\{title\}/g, v.title).replace(/\{body\}/g, v.body ?? '').replace(/\{link\}/g, v.link ?? '')
    .replace(/\n{3,}/g, '\n\n').replace(/: $/, '').trim();
}

// ── Help desk (PRD §14) ──
export const TICKET_CATEGORY_KEYS = ['CLASS', 'TECHNICAL', 'FEES', 'CERTIFICATE', 'OTHER'] as const;
export const ticketSchema = z.object({
  category: z.enum(TICKET_CATEGORY_KEYS, { errorMap: () => ({ message: 'Choose a category' }) }),
  subject: z.string().trim().min(4, 'Write a short subject').max(150),
  description: z.string().trim().min(5, 'Describe the problem').max(5000),
  branchId: z.string().optional(),
  fileIds: z.array(z.string()).max(5).default([]),
});
export const ticketReplySchema = z.object({
  body: z.string().trim().min(1, 'Write a reply').max(5000),
  internal: z.boolean().default(false),
  fileIds: z.array(z.string()).max(5).default([]),
  status: z.enum(['IN_PROGRESS', 'WAITING', 'RESOLVED']).optional(),
});
export const ticketStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']) });

/** Business days: Monday to Saturday, skipping holidays (the institute works Saturdays). */
export function addBusinessDays(from: Date, days: number, holidays: Set<string> = new Set()): Date {
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const ist = new Date(d.getTime() + 5.5 * 3600_000);
    const key = ist.toISOString().slice(0, 10);
    if (ist.getUTCDay() !== 0 && !holidays.has(key)) left--;
  }
  return d;
}
