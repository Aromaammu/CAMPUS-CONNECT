import type { BATCH_MODES, LiveRefusal, LiveRole, LiveRoomState, SESSION_STATUS } from '@cc/shared';

export interface LiveInfo {
  /** 'meeting' for staff meetings; classes leave it out. */
  kind?: 'session' | 'meeting';
  /** API address of this room (classes: /live/sessions/<id>, meetings: /live/meetings/<id>). */
  base?: string;
  session: { id: string; position: number; startsAt: string; endsAt: string; status: keyof typeof SESSION_STATUS; topic: string | null; liveStartedAt: string | null };
  batch: { id: string; name: string; mode: keyof typeof BATCH_MODES; course: string; branch: { id: string; code: string; name: string } };
  teacher: string | null;
  role: LiveRole;
  isHost: boolean;
  canManageGuests: boolean;
  refusal: LiveRefusal | null;
  refusalMessage: string | null;
  opensAt: string;
  state: LiveRoomState;
}

export interface JoinResult { token: string; url: string; room: string; role: LiveRole; identity: string; isHost: boolean }

export interface DeviceChoices { audio: boolean; video: boolean; audioDeviceId?: string; videoDeviceId?: string }

export interface PeopleResult {
  students: { userId: string; name: string; code: string; inRoom: boolean; firstJoinAt: string | null; lastLeftAt: string | null; seconds: number; removed: boolean }[];
  guests: { userId: string; name: string; detail: string }[];
  removedUserIds: string[];
}

export type LeftReason = 'left' | 'ended' | 'removed' | 'duplicate' | 'lost';

/** API address of a room. */
export const liveBase = (info: { base?: string; session: { id: string } }) => info.base ?? `/live/sessions/${info.session.id}`;
