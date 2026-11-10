import { LIVE_REACTIONS, LiveControlAction, LiveRoomState } from '@cc/shared';
import { BarChart3, Camera, CircleDot, PenLine, CameraOff, Hand, LayoutGrid, Lock, MessageSquare, MessageSquareOff, Mic, MicOff, MonitorUp, PhoneOff, Unlock, User, VolumeX } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { Modal, useToast } from '@/components/ui';
import { post } from '@/lib/api';
import { liveBase } from './types';
import type { LiveInfo } from './types';

/** "More options": view, sharing and reactions for everyone; class controls for the teacher. */
export function HostMenu({ open, onClose, info, isHost, state, layout, onLayout, canShare, sharing, onShare, onReact, onEnd, onPolls, onBoard, onRecord }: {
  open: boolean; onClose: () => void; info: LiveInfo; isHost: boolean; state: LiveRoomState;
  layout: 'gallery' | 'speaker'; onLayout: (l: 'gallery' | 'speaker') => void;
  canShare: boolean; sharing: boolean; onShare: () => void; onReact?: (e: string) => void; onEnd: () => void; onPolls?: () => void; onBoard?: () => void; onRecord?: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (action: LiveControlAction, done: string) => {
    setBusy(action);
    try {
      await post(`${liveBase(info)}/control`, { action });
      toast(done);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };
  const close = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <Modal open={open} onClose={onClose} title="More options" size="sm">
      <div className="grid gap-4">
        <section className="grid gap-1.5">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">View</h3>
          <div className="grid grid-cols-2 gap-2">
            <Opt active={layout === 'gallery'} icon={<LayoutGrid className="h-4 w-4" />} onClick={close(() => onLayout('gallery'))}>Gallery</Opt>
            <Opt active={layout === 'speaker'} icon={<User className="h-4 w-4" />} onClick={close(() => onLayout('speaker'))}>Speaker</Opt>
          </div>
          {canShare && <Opt icon={<MonitorUp className="h-4 w-4" />} onClick={close(onShare)}>{sharing ? 'Stop sharing your screen' : 'Share your screen'}</Opt>}
        </section>
        {onReact && (
          <section className="grid gap-1.5">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">Reactions</h3>
            <div className="flex flex-wrap gap-1">
              {LIVE_REACTIONS.map((e) => <button key={e} type="button" onClick={close(() => onReact(e))} className="rounded-lg border border-line px-2 text-[24px] leading-[40px] hover:bg-surface-2" aria-label={`React ${e}`}>{e}</button>)}
            </div>
          </section>
        )}
        {isHost && (
          <section className="grid gap-1.5" aria-label="Class controls">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">Class controls</h3>
            {onPolls && <Opt icon={<BarChart3 className="h-4 w-4" />} onClick={close(onPolls)}>Polls</Opt>}
            {onRecord && <Opt icon={<CircleDot className="h-4 w-4" />} onClick={close(onRecord)}>{state.recording ? 'Stop recording' : 'Start recording'}</Opt>}
            {onBoard && <Opt icon={<PenLine className="h-4 w-4" />} onClick={close(onBoard)}>{state.board ? 'Close the whiteboard' : 'Open the whiteboard'}</Opt>}
            <Opt icon={<VolumeX className="h-4 w-4" />} busy={busy === 'mute-all'} onClick={() => act('mute-all', 'Everyone was muted')}>Mute everyone</Opt>
            <Opt icon={<Hand className="h-4 w-4" />} busy={busy === 'lower-all-hands'} onClick={() => act('lower-all-hands', 'All hands lowered')}>Lower all hands</Opt>
            {state.locked
              ? <Opt icon={<Unlock className="h-4 w-4" />} busy={busy === 'unlock'} onClick={() => act('unlock', 'Class unlocked: students can join')}>Unlock the class</Opt>
              : <Opt icon={<Lock className="h-4 w-4" />} busy={busy === 'lock'} onClick={() => act('lock', 'Class locked: no new students can join')}>Lock the class</Opt>}
            {state.chatDisabled
              ? <Opt icon={<MessageSquare className="h-4 w-4" />} busy={busy === 'chat-on'} onClick={() => act('chat-on', 'Student chat is on')}>Turn on student chat</Opt>
              : <Opt icon={<MessageSquareOff className="h-4 w-4" />} busy={busy === 'chat-off'} onClick={() => act('chat-off', 'Student chat is off')}>Turn off student chat</Opt>}
            {state.micAllowed
              ? <Opt icon={<MicOff className="h-4 w-4" />} busy={busy === 'mic-block'} onClick={() => act('mic-block', 'Students can no longer use their microphones')}>Block student microphones</Opt>
              : <Opt icon={<Mic className="h-4 w-4" />} busy={busy === 'mic-allow'} onClick={() => act('mic-allow', 'Students can use their microphones')}>Allow student microphones</Opt>}
            {state.camAllowed
              ? <Opt icon={<CameraOff className="h-4 w-4" />} busy={busy === 'cam-block'} onClick={() => act('cam-block', 'Students can no longer use their cameras')}>Block student cameras</Opt>
              : <Opt icon={<Camera className="h-4 w-4" />} busy={busy === 'cam-allow'} onClick={() => act('cam-allow', 'Students can use their cameras')}>Allow student cameras</Opt>}
            <Opt danger icon={<PhoneOff className="h-4 w-4" />} onClick={close(onEnd)}>{info.kind === 'meeting' ? 'End meeting for everyone' : 'End class for everyone'}</Opt>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Opt({ children, icon, onClick, active, danger, busy }: { children: ReactNode; icon: ReactNode; onClick: () => void; active?: boolean; danger?: boolean; busy?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={active}
      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-[14.5px] font-semibold transition-colors disabled:opacity-50 ${active ? 'border-brand bg-brand-soft' : 'border-line hover:bg-surface-2'} ${danger ? 'text-bad' : ''}`}
    >
      {icon}{children}
    </button>
  );
}
