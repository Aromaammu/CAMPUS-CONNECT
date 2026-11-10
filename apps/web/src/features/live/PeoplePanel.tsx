import { ConnectionQualityIndicator, useRoomContext } from '@livekit/components-react';
import { LIVE_ROLE_LABELS, LiveControlAction, LiveRoomState, formatTime } from '@cc/shared';
import { useQuery } from '@tanstack/react-query';
import { Hand, Mic, MicOff, MonitorUp, MoreVertical, Video, VideoOff, X } from 'lucide-react';
import { Participant, Track } from 'livekit-client';
import { useState } from 'react';
import { Avatar, useConfirm, useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import { GuestManager } from './GuestManager';
import { roleOf, useRoomVersion } from './Room';
import type { JoinResult, LiveInfo, PeopleResult } from './types';

export function PeoplePanel({ info, join, state, onClose }: { info: LiveInfo; join: JoinResult; state: LiveRoomState; onClose: () => void }) {
  const room = useRoomContext();
  useRoomVersion();
  const toast = useToast();
  const confirm = useConfirm();
  const [menu, setMenu] = useState<string | null>(null);
  const isHost = join.isHost;
  const people = useQuery({
    queryKey: ['live-people', info.session.id],
    queryFn: () => get<PeopleResult>(`/live/sessions/${info.session.id}/people`),
    enabled: isHost || info.canManageGuests,
    refetchInterval: 10_000,
  });

  const all: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()].filter((p) => roleOf(p) !== 'observer' || p.identity === join.identity);
  const order = (p: Participant) => (roleOf(p) === 'teacher' ? 0 : roleOf(p) === 'guest' ? 1 : 2);
  all.sort((a, b) => order(a) - order(b) || (a.name ?? '').localeCompare(b.name ?? ''));
  const hands = all.filter((p) => p.attributes?.hand).sort((a, b) => Number(a.attributes.hand) - Number(b.attributes.hand));
  const here = new Set(all.map((p) => p.identity));
  const away = (people.data?.students ?? []).filter((s) => !here.has(s.userId));

  const act = async (action: LiveControlAction, identity?: string, done?: string) => {
    setMenu(null);
    try {
      await post(`/live/sessions/${info.session.id}/control`, { action, identity });
      if (done) toast(done);
      if (action === 'remove' || action === 'let-back') void people.refetch();
    } catch (e) {
      toast((e as Error).message, 'bad');
    }
  };
  const remove = async (p: Participant) => {
    const r = await confirm({ title: `Remove ${p.name} from the class?`, body: 'They will be disconnected and cannot rejoin this class unless you let them back in.', confirmLabel: 'Remove', danger: true });
    if (r.ok) await act('remove', p.identity, `${p.name} was removed`);
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[15px] font-bold">People ({all.length})</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close people"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {hands.length > 0 && (
          <section className="mb-4" aria-label="Raised hands">
            <div className="mb-1.5 flex items-center justify-between">
              <h3 className="text-[13px] font-bold uppercase tracking-wide text-[#ffcf8a]">Raised hands ({hands.length})</h3>
              {isHost && <button type="button" className="text-[13px] font-semibold text-[#ffcf8a] hover:underline" onClick={() => act('lower-all-hands')}>Lower all</button>}
            </div>
            <ol className="grid gap-1">
              {hands.map((p, i) => (
                <li key={p.identity} className="flex items-center gap-2 rounded-lg bg-[#C77C12]/20 px-2 py-1.5 text-[14px]">
                  <span className="w-5 text-center font-bold tabular-nums">{i + 1}</span>
                  <Hand className="h-4 w-4 text-[#ffcf8a]" />
                  <span className="min-w-0 flex-1 truncate">{p.identity === join.identity ? 'You' : p.name}</span>
                  {isHost && <button type="button" className="rounded px-2 py-0.5 text-[13px] font-semibold hover:bg-white/10" onClick={() => act('lower-hand', p.identity)} aria-label={`Lower ${p.name}'s hand`}>Lower</button>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-white/60">In the class</h3>
        <ul className="grid gap-1" aria-label="In the class">
          {all.map((p) => {
            const role = roleOf(p);
            const me = p.identity === join.identity;
            const mic = p.getTrackPublication(Track.Source.Microphone);
            const cam = p.getTrackPublication(Track.Source.Camera);
            const share = p.getTrackPublication(Track.Source.ScreenShare);
            const canAct = isHost && !me && role !== 'teacher';
            const shareAllowed = state.shareUserIds.includes(p.identity);
            return (
              <li key={p.identity} className="relative flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-white/5">
                <Avatar name={p.name || '?'} size={30} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14.5px] font-semibold">{me ? `${p.name} (you)` : p.name}</div>
                  <div className="text-[12.5px] text-white/60">{LIVE_ROLE_LABELS[role]}{p.joinedAt ? ` · joined ${formatTime(p.joinedAt)}` : ''}</div>
                </div>
                {share && !share.isMuted && <MonitorUp className="h-4 w-4 text-[#9fd8e8]" aria-label="Sharing screen" />}
                {mic && !mic.isMuted ? <Mic className="h-4 w-4" aria-label="Microphone on" /> : <MicOff className="h-4 w-4 text-white/40" aria-label="Microphone off" />}
                {cam && !cam.isMuted ? <Video className="h-4 w-4" aria-label="Camera on" /> : <VideoOff className="h-4 w-4 text-white/40" aria-label="Camera off" />}
                <ConnectionQualityIndicator participant={p} className="h-4 w-4" />
                {canAct && (
                  <button type="button" className="rounded p-1 hover:bg-white/10" onClick={() => setMenu(menu === p.identity ? null : p.identity)} aria-label={`Actions for ${p.name}`} aria-expanded={menu === p.identity}>
                    <MoreVertical className="h-4 w-4" />
                  </button>
                )}
                {menu === p.identity && (
                  <div role="menu" aria-label={`Actions for ${p.name}`} className="absolute right-1 top-full z-10 grid min-w-[200px] gap-0.5 rounded-lg bg-[#173640] p-1 shadow-xl">
                    <MenuItem onClick={() => act('mute', p.identity, `${p.name} was muted`)}>Mute microphone</MenuItem>
                    <MenuItem onClick={() => act('camera-off', p.identity, `${p.name}'s camera was turned off`)}>Turn off camera</MenuItem>
                    {role === 'student' && (shareAllowed
                      ? <MenuItem onClick={() => act('share-revoke', p.identity, `${p.name} can no longer share`)}>Stop screen sharing</MenuItem>
                      : <MenuItem onClick={() => act('share-allow', p.identity, `${p.name} can now share their screen`)}>Let them share screen</MenuItem>)}
                    {p.attributes?.hand && <MenuItem onClick={() => act('lower-hand', p.identity)}>Lower hand</MenuItem>}
                    <MenuItem danger onClick={() => remove(p)}>Remove from class</MenuItem>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {(isHost || info.canManageGuests) && (
          <>
            <h3 className="mb-1.5 mt-4 text-[13px] font-bold uppercase tracking-wide text-white/60">Not in the class ({away.length})</h3>
            {people.isLoading ? <p className="text-[13px] text-white/60">Loading…</p> : away.length === 0 ? <p className="text-[13px] text-white/60">Every enrolled student is here.</p> : (
              <ul className="grid gap-1" aria-label="Not in the class">
                {away.map((s) => (
                  <li key={s.userId} className="flex items-center gap-2 px-1 py-1 text-[14px]">
                    <Avatar name={s.name} size={26} className="opacity-60" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{s.name}</div>
                      <div className="text-[12.5px] text-white/60">{s.code} · {s.removed ? 'Removed by the teacher' : s.lastLeftAt ? `Left at ${formatTime(s.lastLeftAt)}` : s.inRoom ? 'Connecting…' : 'Not joined yet'}</div>
                    </div>
                    {s.removed && isHost && <button type="button" className="rounded px-2 py-0.5 text-[13px] font-semibold text-[#ffcf8a] hover:bg-white/10" onClick={() => act('let-back', s.userId, `${s.name} can join again`)}>Let back in</button>}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {info.canManageGuests && <div className="mt-5 border-t border-white/10 pt-4"><GuestManager sessionId={info.session.id} dark /></div>}
      </div>
    </>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return <button type="button" role="menuitem" onClick={onClick} className={`rounded px-3 py-2 text-left text-[14px] hover:bg-white/10 ${danger ? 'text-[#ff8a8a]' : ''}`}>{children}</button>;
}
