import { z } from 'zod';

/** How someone takes part in a live class (PRD §7.1). */
export type LiveRole = 'teacher' | 'student' | 'guest' | 'observer';
export const LIVE_ROLE_LABELS: Record<LiveRole, string> = { teacher: 'Teacher', student: 'Student', guest: 'Guest', observer: 'Observer' };

/** Why someone cannot enter right now. */
export const LIVE_REFUSALS = {
  NOT_ALLOWED: 'Only students enrolled in this batch, its teachers and invited guests can join this class.',
  NOT_ACTIVE: 'Your place in this batch is not active right now. Please contact your branch.',
  OFFLINE: 'This class happens in the classroom, not online.',
  CANCELLED: 'This class was cancelled.',
  TOO_EARLY: 'This class has not opened yet.',
  ENDED: 'This class has ended.',
  LOCKED: 'The teacher has locked this class. Please contact your teacher.',
  REMOVED: 'The teacher removed you from this class.',
  NETWORK_FULL: 'The maximum number of live classes is running right now. Please try again in a few minutes.',
  ROOM_FULL: 'This class is full.',
} as const;
export type LiveRefusal = keyof typeof LIVE_REFUSALS;

/** Room switches the teacher controls; sent to everyone as room metadata. */
export interface LiveRoomState {
  chatDisabled: boolean;
  locked: boolean;
  micAllowed: boolean;
  camAllowed: boolean;
  shareUserIds: string[];
  board: boolean;
  penUserIds: string[];
}

export function parseRoomState(metadata: string | undefined | null): LiveRoomState {
  const base: LiveRoomState = { chatDisabled: false, locked: false, micAllowed: true, camAllowed: true, shareUserIds: [], board: false, penUserIds: [] };
  if (!metadata) return base;
  try {
    return { ...base, ...(JSON.parse(metadata) as Partial<LiveRoomState>) };
  } catch {
    return base;
  }
}

/** What each participant carries as metadata. */
export interface LiveParticipantMeta { role: LiveRole; code?: string }

export const LIVE_CONTROL_ACTIONS = [
  'mute', 'camera-off', 'stop-share', 'share-allow', 'share-revoke', 'remove', 'let-back', 'lower-hand',
  'mute-all', 'lower-all-hands', 'lock', 'unlock', 'chat-off', 'chat-on', 'mic-allow', 'mic-block', 'cam-allow', 'cam-block', 'end',
  'board-open', 'board-close', 'pen-give', 'pen-take',
] as const;
export type LiveControlAction = (typeof LIVE_CONTROL_ACTIONS)[number];
/** Actions aimed at one person (need `identity`). */
export const LIVE_PERSON_ACTIONS: LiveControlAction[] = ['mute', 'camera-off', 'stop-share', 'share-allow', 'share-revoke', 'remove', 'let-back', 'lower-hand', 'pen-give', 'pen-take'];

export const liveControlSchema = z
  .object({ action: z.enum(LIVE_CONTROL_ACTIONS), identity: z.string().min(1).max(64).optional() })
  .refine((v) => !LIVE_PERSON_ACTIONS.includes(v.action) || !!v.identity, { message: 'Choose a person', path: ['identity'] });
export type LiveControlInput = z.infer<typeof liveControlSchema>;

export const liveChatSchema = z.object({ text: z.string().trim().min(1, 'Type a message').max(1000, 'Keep messages under 1,000 characters') });
export const liveHandSchema = z.object({ raised: z.boolean() });
export const liveGuestSchema = z.object({ userId: z.string().min(1) });

/** Data-channel topics used in the room. */
export const LIVE_TOPICS = { chat: 'chat', reaction: 'reaction', notice: 'notice', board: 'wb' } as const;
export const LIVE_REACTIONS = ['👍', '👏', '😀', '❤️', '🎉', '🤔'] as const;

export interface LiveChatMessage { id: string; userId: string; name: string; role: LiveRole | null; text: string; createdAt: string }

/** Room name for a class session or a staff meeting. */
export const liveRoomName = (kind: 'session' | 'meeting', id: string) => `${kind === 'session' ? 's' : 'm'}_${id}`;
export function parseLiveRoomName(name: string): { kind: 'session' | 'meeting'; id: string } | null {
  const m = /^(s|m)_(.+)$/.exec(name);
  return m ? { kind: m[1] === 's' ? 'session' : 'meeting', id: m[2] } : null;
}

/** Merge presence intervals (reconnects overlap or touch) and return total seconds inside [from, to]. */
export function presenceSeconds(intervals: { joinedAt: Date; leftAt: Date | null }[], from: Date, to: Date, now = new Date()): number {
  const clipped = intervals
    .map((i) => [Math.max(i.joinedAt.getTime(), from.getTime()), Math.min((i.leftAt ?? now).getTime(), to.getTime())] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [a, b] of clipped) {
    if (!cur || a > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [a, b];
    } else cur[1] = Math.max(cur[1], b);
  }
  if (cur) total += cur[1] - cur[0];
  return Math.round(total / 1000);
}

/** Polls (PRD §7.2). */
export const pollSchema = z.object({
  question: z.string().trim().min(3, 'Write the question').max(300),
  options: z.array(z.string().trim().min(1, 'Fill in this option').max(120)).min(2, 'At least 2 options').max(6, 'At most 6 options'),
  multi: z.boolean().default(false),
  showResults: z.boolean().default(true),
  saveTemplate: z.boolean().default(false),
});
export type PollInput = z.infer<typeof pollSchema>;
export const pollVoteSchema = z.object({ choices: z.array(z.number().int().min(0).max(5)).min(1, 'Choose an answer').max(6) });

export interface PollView {
  id: string; question: string; options: string[]; multi: boolean; status: 'OPEN' | 'CLOSED'; showResults: boolean; createdAt: string;
  /** Votes per option; null when the viewer may not see results yet. */
  counts: number[] | null; voters: number | null; myChoices: number[] | null;
}
