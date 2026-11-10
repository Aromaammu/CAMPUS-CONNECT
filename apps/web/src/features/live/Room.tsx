import {
  LiveKitRoom, ParticipantTile, RoomAudioRenderer, StartAudio, TrackRefContext,
  useConnectionState, useLocalParticipant, useMaybeTrackRefContext, useRoomContext, useRoomInfo, useTracks, type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';
import { LIVE_REACTIONS, LiveChatMessage, LiveParticipantMeta, LiveRole, parseRoomState } from '@cc/shared';
import clsx from 'clsx';
import {
  BarChart3, ClipboardCheck, Hand, LayoutGrid, LogOut, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, Lock, Smile, Users, Video, VideoOff, User as UserIcon, WifiOff,
} from 'lucide-react';
import { ConnectionState, DisconnectReason, Participant, RoomEvent, Track, type RoomOptions } from 'livekit-client';
import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useConfirm, useToast } from '@/components/ui';
import { post } from '@/lib/api';
import { ChatPanel, useClassChat } from './ChatPanel';
import { PeoplePanel } from './PeoplePanel';
import { HostMenu } from './HostMenu';
import { AttendancePanel, CheckinPrompt } from './AttendancePanel';
import { PollsPanel, StudentPoll } from './Polls';
import { get } from '@/lib/api';
import { softenExpectedLiveKitErrors } from './logging';
import type { DeviceChoices, JoinResult, LeftReason, LiveInfo } from './types';

softenExpectedLiveKitErrors();

/** Protocol track-source numbers used in participant permissions. */
export const SRC = { camera: 1, microphone: 2, screen: 3 } as const;

export function metaOf(p: Participant): LiveParticipantMeta {
  try { return JSON.parse(p.metadata || '{}') as LiveParticipantMeta; } catch { return { role: 'student' }; }
}
export const roleOf = (p: Participant): LiveRole => metaOf(p).role ?? 'student';

/** Re-render whenever anything about the people in the room changes. */
export function useRoomVersion() {
  const room = useRoomContext();
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    const evs = [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantMetadataChanged,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.TrackPublished, RoomEvent.TrackUnpublished, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
      RoomEvent.ConnectionQualityChanged, RoomEvent.ParticipantPermissionsChanged, RoomEvent.ActiveSpeakersChanged, RoomEvent.Connected,
    ] as const;
    evs.forEach((e) => room.on(e, bump));
    return () => { evs.forEach((e) => room.off(e, bump)); };
  }, [room]);
  return v;
}

export function canPublishSource(p: Participant | undefined, src: number) {
  const perm = p?.permissions;
  if (!perm) return true;
  if (!perm.canPublish) return false;
  return perm.canPublishSources.length === 0 || perm.canPublishSources.includes(src);
}

export function Room({ info, join, choices, onLeft }: { info: LiveInfo; join: JoinResult; choices: DeviceChoices; onLeft: (r: LeftReason) => void }) {
  const leaving = useRef<LeftReason | null>(null);
  const setLeaving = useCallback((r: LeftReason) => { leaving.current = r; }, []);
  const options = useMemo<RoomOptions>(() => ({
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : undefined,
    audioCaptureDefaults: choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : undefined,
  }), [choices.videoDeviceId, choices.audioDeviceId]);
  const onDisconnected = useCallback((reason?: DisconnectReason) => {
    if (reason === DisconnectReason.CLIENT_INITIATED) {
      // Also fires when React re-mounts in development; only a real "Leave" press counts.
      if (leaving.current) onLeft(leaving.current);
      return;
    }
    if (reason === DisconnectReason.DUPLICATE_IDENTITY) onLeft('duplicate');
    else if (reason === DisconnectReason.PARTICIPANT_REMOVED) onLeft('removed');
    else if (reason === DisconnectReason.ROOM_DELETED) onLeft('ended');
    else onLeft('lost');
  }, [onLeft]);

  return (
    <LiveKitRoom
      serverUrl={join.url}
      token={join.token}
      connect
      audio={choices.audio}
      video={choices.video}
      options={options}
      onDisconnected={onDisconnected}
      onError={() => undefined}
      data-lk-theme="default"
      className="cc-live flex h-dvh flex-col overflow-hidden bg-[#0b1d24] text-white"
    >
      <ClassRoom info={info} join={join} onLeave={setLeaving} />
      <RoomAudioRenderer />
    </LiveKitRoom>
  );
}

type Panel = 'chat' | 'people' | 'attendance' | 'polls' | null;
type FloatingReaction = { id: number; emoji: string; name: string };

function ClassRoom({ info, join, onLeave }: { info: LiveInfo; join: JoinResult; onLeave: (reason: LeftReason) => void }) {
  const room = useRoomContext();
  const toast = useToast();
  const confirm = useConfirm();
  const roomInfo = useRoomInfo();
  const state = parseRoomState(roomInfo.metadata);
  const conn = useConnectionState();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant();
  useRoomVersion();
  const [panel, setPanel] = useState<Panel>(() => (window.innerWidth >= 1024 ? 'chat' : null));
  const [layout, setLayout] = useState<'gallery' | 'speaker'>('gallery');
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [hostOpen, setHostOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isHost = join.isHost;
  const isStudent = join.role === 'student';
  const observer = join.role === 'observer';
  const myHand = localParticipant.attributes?.hand;

  // Chat: count unread while the panel is closed.
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const onChatMessage = useCallback((m: LiveChatMessage) => {
    if (panelRef.current !== 'chat' && m.userId !== join.identity) setUnread((u) => u + 1);
  }, [join.identity]);
  useEffect(() => { if (panel === 'chat') setUnread(0); }, [panel]);
  const chat = useClassChat(info.session.id, onChatMessage);

  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;

  // Check-ins: a student sees "Mark your attendance" while one is open (also after joining late or refreshing).
  const [checkin, setCheckin] = useState<{ windowId: string; closesAt: string } | null>(null);
  useEffect(() => {
    if (!isStudent) return;
    get<{ open: { windowId: string; closesAt: string; answered: boolean } | null }>(`/attendance/sessions/${info.session.id}/checkin`)
      .then((r) => { if (r.open && !r.open.answered) setCheckin({ windowId: r.open.windowId, closesAt: r.open.closesAt }); })
      .catch(() => undefined);
  }, [isStudent, info.session.id]);
  const clearCheckin = useCallback(() => setCheckin(null), []);

  // Reactions and teacher notices over the data channel.
  useEffect(() => {
    const onData = (payload: Uint8Array, p?: Participant, _k?: unknown, topic?: string) => {
      if (topic === 'notice') {
        try {
          const n = JSON.parse(new TextDecoder().decode(payload)) as { type: string; windowId?: string; closesAt?: string };
          if (n.type === 'ended') { onLeaveRef.current('ended'); void room.disconnect(); return; }
          if (n.type === 'checkin' && n.windowId && n.closesAt && roleOf(room.localParticipant) === 'student') setCheckin({ windowId: n.windowId, closesAt: n.closesAt });
        } catch { /* ignore */ }
        return;
      }
      if (topic !== 'reaction') return;
      try {
        const { emoji } = JSON.parse(new TextDecoder().decode(payload)) as { emoji: string };
        if (!(LIVE_REACTIONS as readonly string[]).includes(emoji)) return;
        const r = { id: Date.now() + Math.random(), emoji, name: p?.name ?? 'Someone' };
        setReactions((x) => [...x.slice(-12), r]);
        setTimeout(() => setReactions((x) => x.filter((y) => y.id !== r.id)), 4000);
      } catch { /* ignore bad packets */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room]);

  // Teacher hears about raised hands.
  useEffect(() => {
    if (!isHost) return;
    const onAttr = (changed: Record<string, string>, p: Participant) => {
      if (changed.hand && p.identity !== join.identity) toast(`${p.name} raised their hand`, 'info');
    };
    room.on(RoomEvent.ParticipantAttributesChanged, onAttr);
    return () => { room.off(RoomEvent.ParticipantAttributesChanged, onAttr); };
  }, [room, isHost, join.identity, toast]);

  // Tell students when the teacher changes their permissions.
  const prev = useRef(state);
  useEffect(() => {
    const p = prev.current;
    if (isStudent) {
      if (p.micAllowed && !state.micAllowed) toast('The teacher turned off student microphones', 'info');
      if (!p.micAllowed && state.micAllowed) toast('You can use your microphone again', 'info');
      if (p.camAllowed && !state.camAllowed) toast('The teacher turned off student cameras', 'info');
      if (!p.chatDisabled && state.chatDisabled) toast('The teacher turned off chat', 'info');
      if (!p.shareUserIds.includes(join.identity) && state.shareUserIds.includes(join.identity)) toast('The teacher lets you share your screen', 'info');
    }
    prev.current = state;
  }, [state, isStudent, join.identity, toast]);

  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }, { source: Track.Source.ScreenShare, withPlaceholder: false }], { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false });
  const visible = tracks.filter((t) => roleOf(t.participant) !== 'observer');
  const screen = visible.find((t) => t.source === Track.Source.ScreenShare);
  const cameras = visible.filter((t) => t.source === Track.Source.Camera);
  const speaker = room.activeSpeakers.find((p) => p.identity !== join.identity && roleOf(p) !== 'observer');
  const teacherCam = cameras.find((t) => roleOf(t.participant) === 'teacher');
  const focus: TrackReferenceOrPlaceholder | undefined = screen ?? (layout === 'speaker' ? (cameras.find((t) => t.participant.identity === speaker?.identity) ?? teacherCam ?? cameras[0]) : undefined);

  const toggle = async (key: string, fn: () => Promise<unknown>, fail: string) => {
    setBusy(key);
    try { await fn(); } catch { toast(fail, 'bad'); } finally { setBusy(null); }
  };
  const micOk = canPublishSource(localParticipant, SRC.microphone);
  const camOk = canPublishSource(localParticipant, SRC.camera);
  const shareOk = canPublishSource(localParticipant, SRC.screen) && !observer;

  const sendReaction = async (emoji: string) => {
    setShowReactions(false);
    await localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji })), { reliable: true, topic: 'reaction' });
    const r = { id: Date.now() + Math.random(), emoji, name: 'You' };
    setReactions((x) => [...x.slice(-12), r]);
    setTimeout(() => setReactions((x) => x.filter((y) => y.id !== r.id)), 4000);
  };
  const raiseHand = () => toggle('hand', () => post(`/live/sessions/${info.session.id}/hand`, { raised: !myHand }), 'Could not reach the class server');
  const leave = async () => {
    onLeave('left');
    await room.disconnect();
  };
  const endClass = async () => {
    const r = await confirm({ title: 'End the class for everyone?', body: 'Everyone will be disconnected and nobody can rejoin this class.', confirmLabel: 'End class', danger: true });
    if (!r.ok) return;
    try {
      await post(`/live/sessions/${info.session.id}/control`, { action: 'end' });
      // Don't wait for the class server to close the room: leave straight away.
      onLeave('ended');
      await room.disconnect();
    } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const hands = Array.from(room.remoteParticipants.values()).filter((p) => p.attributes?.hand).length + (myHand ? 1 : 0);
  const inRoom = 1 + Array.from(room.remoteParticipants.values()).filter((p) => roleOf(p) !== 'observer').length - (observer ? 1 : 0);

  return (
    <>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded bg-[#d64545] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide">Live</span>
            <h1 className="truncate text-[15px] font-bold">{info.batch.name} · Class {info.session.position}</h1>
          </div>
          <p className="truncate text-[12.5px] text-white/60">{info.batch.course}{observer ? ' · You are observing silently' : ''}</p>
        </div>
        {state.locked && <span className="hidden items-center gap-1 text-[13px] text-white/80 sm:inline-flex" title="The class is locked"><Lock className="h-4 w-4" />Locked</span>}
        {isHost && hands > 0 && <button type="button" onClick={() => setPanel('people')} className="inline-flex items-center gap-1 rounded-full bg-[#C77C12] px-2 py-0.5 text-[13px] font-bold" aria-label={`${hands} raised hands`}><Hand className="h-4 w-4" />{hands}</button>}
        <span className="inline-flex items-center gap-1 text-[13px] text-white/80" aria-label={`${inRoom} in class`}><Users className="h-4 w-4" />{inRoom}</span>
      </header>

      {conn === ConnectionState.Reconnecting && (
        <div role="status" className="flex items-center justify-center gap-2 bg-[#C77C12] px-3 py-1.5 text-[14px] font-semibold"><WifiOff className="h-4 w-4" />Reconnecting… your attendance time continues.</div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 p-2" aria-label="Class video">
          {focus ? <SpeakerView focus={focus} others={visible.filter((t) => t !== focus)} /> : <Gallery tracks={cameras} />}
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col-reverse gap-1" aria-live="polite">
            {reactions.map((r) => (
              <div key={r.id} className="cc-float flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[14px]"><span className="text-[22px] leading-none">{r.emoji}</span>{r.name}</div>
            ))}
          </div>
          <StartAudio label="Tap to turn on class sound" className="absolute left-1/2 top-3 -translate-x-1/2 rounded-lg bg-[#C77C12] px-4 py-2 text-[14px] font-bold" />
          {(isStudent || join.role === 'guest') && <StudentPoll sessionId={info.session.id} />}
          {checkin && <CheckinPrompt sessionId={info.session.id} windowId={checkin.windowId} closesAt={checkin.closesAt} onDone={clearCheckin} />}
        </main>
        {panel && (
          <aside className="absolute inset-0 z-20 flex flex-col bg-[#0f262e] lg:static lg:z-auto lg:w-[360px] lg:border-l lg:border-white/10" aria-label={panel === 'chat' ? 'Chat' : panel === 'attendance' ? 'Attendance' : panel === 'polls' ? 'Polls' : 'People'}>
            {panel === 'chat'
              ? <ChatPanel info={info} join={join} chatDisabled={state.chatDisabled} messages={chat.messages} onSent={chat.add} onClose={() => setPanel(null)} />
              : panel === 'attendance' ? <AttendancePanel info={info} onClose={() => setPanel(null)} />
              : panel === 'polls' ? <PollsPanel sessionId={info.session.id} onClose={() => setPanel(null)} />
              : <PeoplePanel info={info} join={join} state={state} onClose={() => setPanel(null)} />}
          </aside>
        )}
      </div>

      <footer className="relative flex items-center justify-center gap-1 border-t border-white/10 px-2 py-2 sm:gap-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        {!observer && (
          <>
            <Ctl label={isMicrophoneEnabled ? 'Turn off microphone' : micOk ? 'Turn on microphone' : 'Microphone turned off by the teacher'} on={isMicrophoneEnabled} disabled={!micOk || busy === 'mic'} danger={!isMicrophoneEnabled} onClick={() => toggle('mic', () => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled), 'Could not use your microphone')}>
              {isMicrophoneEnabled ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
            </Ctl>
            <Ctl label={isCameraEnabled ? 'Turn off camera' : camOk ? 'Turn on camera' : 'Camera turned off by the teacher'} on={isCameraEnabled} disabled={!camOk || busy === 'cam'} danger={!isCameraEnabled} onClick={() => toggle('cam', () => localParticipant.setCameraEnabled(!isCameraEnabled), 'Could not use your camera')}>
              {isCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
            </Ctl>
            {shareOk && (
              <Ctl className="hidden sm:inline-flex" label={isScreenShareEnabled ? 'Stop sharing your screen' : 'Share your screen'} on={isScreenShareEnabled} disabled={busy === 'share'} onClick={() => toggle('share', () => localParticipant.setScreenShareEnabled(!isScreenShareEnabled), 'Screen sharing did not start')}>
                <MonitorUp className="h-5 w-5" />
              </Ctl>
            )}
            {!isHost && (
              <Ctl label={myHand ? 'Lower your hand' : 'Raise your hand'} on={!!myHand} highlight={!!myHand} disabled={busy === 'hand'} onClick={raiseHand}><Hand className="h-5 w-5" /></Ctl>
            )}
            <div className="relative hidden sm:block">
              <Ctl label="Send a reaction" on={showReactions} onClick={() => setShowReactions((v) => !v)}><Smile className="h-5 w-5" /></Ctl>
              {showReactions && <ReactionPicker onPick={sendReaction} />}
            </div>
          </>
        )}
        <Ctl label="Chat" on={panel === 'chat'} onClick={() => setPanel((p) => (p === 'chat' ? null : 'chat'))} badge={unread}><MessageSquare className="h-5 w-5" /></Ctl>
        <Ctl label="People" on={panel === 'people'} onClick={() => setPanel((p) => (p === 'people' ? null : 'people'))}><Users className="h-5 w-5" /></Ctl>
        {isHost && info.batch.mode !== 'OFFLINE' && (
          <Ctl label="Attendance" on={panel === 'attendance'} onClick={() => setPanel((p) => (p === 'attendance' ? null : 'attendance'))}><ClipboardCheck className="h-5 w-5" /></Ctl>
        )}
        {isHost && <Ctl className="hidden sm:inline-flex" label="Polls" on={panel === 'polls'} onClick={() => setPanel((p) => (p === 'polls' ? null : 'polls'))}><BarChart3 className="h-5 w-5" /></Ctl>}
        <Ctl className="hidden sm:inline-flex" label={layout === 'gallery' ? 'Switch to speaker view' : 'Switch to gallery view'} onClick={() => setLayout((l) => (l === 'gallery' ? 'speaker' : 'gallery'))}>
          {layout === 'gallery' ? <UserIcon className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
        </Ctl>
        <Ctl label="More options" on={hostOpen} onClick={() => setHostOpen(true)}><MoreHorizontal className="h-5 w-5" /></Ctl>
        <button type="button" onClick={leave} className="ml-1 inline-flex h-11 items-center gap-1.5 rounded-full bg-[#d64545] px-4 text-[14px] font-bold hover:bg-[#c03b3b]" aria-label="Leave class">
          <LogOut className="h-5 w-5" /><span className="hidden sm:inline">Leave</span>
        </button>
      </footer>

      <HostMenu
        open={hostOpen}
        onClose={() => setHostOpen(false)}
        info={info}
        isHost={isHost}
        state={state}
        layout={layout}
        onLayout={setLayout}
        canShare={shareOk}
        sharing={isScreenShareEnabled}
        onShare={() => toggle('share', () => localParticipant.setScreenShareEnabled(!isScreenShareEnabled), 'Screen sharing did not start')}
        onReact={observer ? undefined : sendReaction}
        onEnd={endClass}
        onPolls={isHost ? () => setPanel('polls') : undefined}
      />
    </>
  );
}

const keyOf = (t: TrackReferenceOrPlaceholder) => `${t.participant.identity}_${t.source}`;

/** Picks the column count that gives the biggest 16:9 tiles for this space (like Meet/Teams). */
export function fitGallery(n: number, W: number, H: number, gap = 8, minW = 150) {
  let best = { cols: 1, w: Math.max(minW, W), h: Math.max(minW, W) * 9 / 16, area: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    let w = (W - gap * (cols - 1)) / cols;
    let h = (w * 9) / 16;
    if (h * rows + gap * (rows - 1) > H) { h = (H - gap * (rows - 1)) / rows; w = (h * 16) / 9; }
    if (w < minW) continue;
    if (w * h > best.area) best = { cols, w, h, area: w * h };
  }
  if (best.area === 0) {
    // Too many people to fit: smallest readable tiles, and the gallery scrolls.
    const cols = Math.max(1, Math.floor((W + gap) / (minW + gap)));
    const w = (W - gap * (cols - 1)) / cols;
    best = { cols, w, h: (w * 9) / 16, area: 0 };
  }
  return best;
}

/** Gallery: everyone in an even grid of video-shaped tiles (scrolls when the class is large). */
function Gallery({ tracks }: { tracks: TrackReferenceOrPlaceholder[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = fitGallery(tracks.length, size.w, size.h);
  return (
    <div ref={ref} className="cc-grid h-full" style={{ gridTemplateColumns: `repeat(${fit.cols}, ${Math.floor(fit.w)}px)`, gridAutoRows: `${Math.floor(fit.h)}px` } as CSSProperties} aria-label="Gallery view">
      {size.w > 0 && tracks.map((t) => <TrackRefContext.Provider key={keyOf(t)} value={t}><Tile /></TrackRefContext.Provider>)}
    </div>
  );
}

/** Speaker view: the screen share or the person talking, large; everyone else in a strip. */
function SpeakerView({ focus, others }: { focus: TrackReferenceOrPlaceholder; others: TrackReferenceOrPlaceholder[] }) {
  return (
    <div className="flex h-full flex-col gap-2 lg:flex-row" aria-label="Speaker view">
      <div className="min-h-0 flex-1"><TrackRefContext.Provider value={focus}><Tile /></TrackRefContext.Provider></div>
      {others.length > 0 && (
        <div className="flex h-[96px] shrink-0 gap-2 overflow-x-auto lg:h-auto lg:w-[220px] lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden">
          {others.map((t) => <div key={keyOf(t)} className="aspect-video h-full shrink-0 lg:h-auto lg:w-full"><TrackRefContext.Provider value={t}><Tile /></TrackRefContext.Provider></div>)}
        </div>
      )}
    </div>
  );
}

function Tile() {
  // Hand marker over each tile; the library tile does the video, name and mute icons.
  const ref = useMaybeTrackRefContext();
  const p = ref?.participant;
  return (
    <div className="relative h-full w-full">
      <ParticipantTile />
      {p?.attributes?.hand && <span className="pointer-events-none absolute right-2 top-2 rounded-full bg-[#C77C12] p-1.5" title={`${p.name} raised their hand`}><Hand className="h-4 w-4" /></span>}
      {p && roleOf(p) === 'teacher' && <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] font-bold uppercase">Teacher</span>}
    </div>
  );
}

export function ReactionPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div className="absolute bottom-14 left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full bg-[#173640] p-1.5 shadow-xl" role="menu" aria-label="Reactions">
      {LIVE_REACTIONS.map((e) => (
        <button key={e} type="button" role="menuitem" onClick={() => onPick(e)} className="rounded-full px-1.5 text-[24px] leading-[36px] hover:bg-white/10" aria-label={`React ${e}`}>{e}</button>
      ))}
    </div>
  );
}

function Ctl({ label, on, disabled, danger, highlight, onClick, children, badge, className }: { label: string; on?: boolean; disabled?: boolean; danger?: boolean; highlight?: boolean; onClick: () => void; children: ReactNode; badge?: number; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        'relative inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        highlight ? 'bg-[#C77C12] hover:bg-[#b06c0e]' : danger ? 'bg-white/10 text-[#ff8a8a] hover:bg-white/15' : on ? 'bg-white/25 hover:bg-white/30' : 'bg-white/10 hover:bg-white/15',
        className,
      )}
    >
      {children}
      {!!badge && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-[#C77C12] px-1 text-[11px] font-bold leading-[18px]">{badge > 9 ? '9+' : badge}</span>}
    </button>
  );
}
