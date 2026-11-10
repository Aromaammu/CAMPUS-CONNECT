import { useMediaDevices, usePreviewTracks } from '@livekit/components-react';
import { LIVE_ROLE_LABELS, formatTime, formatWeekdayDate } from '@cc/shared';
import { Camera, CameraOff, Eye, Mic, MicOff, Volume2 } from 'lucide-react';
import { LocalAudioTrack, LocalVideoTrack, Track } from 'livekit-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Notice, Select } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { GuestManager } from './GuestManager';
import type { DeviceChoices, LiveInfo } from './types';

const PREF_KEY = 'cc.live.devices';
function loadPrefs(): DeviceChoices {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? 'null') as DeviceChoices | null;
    if (v) return v;
  } catch { /* storage may be blocked */ }
  return { audio: true, video: true };
}
function savePrefs(c: DeviceChoices) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/** Live microphone level (0–1) from a local audio track. */
function useMicLevel(track: LocalAudioTrack | undefined) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track) { setLevel(0); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const src = ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); src.disconnect(); void ctx.close(); };
  }, [track]);
  return level;
}

function playTestTone() {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 523;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.2);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 1.25);
  osc.onended = () => void ctx.close();
}

export function PreJoin({ info, onJoin, joining, joinError }: { info: LiveInfo; onJoin: (c: DeviceChoices) => void; joining: boolean; joinError: string | null }) {
  const { user } = useAuth();
  const observer = info.role === 'observer';
  const [choices, setChoices] = useState<DeviceChoices>(() => (observer ? { audio: false, video: false } : loadPrefs()));
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const studentMicBlocked = info.role === 'student' && !info.state.micAllowed;
  const studentCamBlocked = info.role === 'student' && !info.state.camAllowed;
  const wantAudio = choices.audio && !studentMicBlocked;
  const wantVideo = choices.video && !studentCamBlocked;

  const options = useMemo(() => ({
    audio: wantAudio ? (choices.audioDeviceId ? { deviceId: choices.audioDeviceId } : true) : false,
    video: wantVideo ? (choices.videoDeviceId ? { deviceId: choices.videoDeviceId } : true) : false,
  }), [wantAudio, wantVideo, choices.audioDeviceId, choices.videoDeviceId]);
  const tracks = usePreviewTracks(options, (e) => setDeviceError(e.name === 'NotAllowedError' ? 'Your browser blocked the camera or microphone. Allow them in the address bar, or join without them.' : 'We could not start your camera or microphone. You can still join and try again inside the class.'));
  const videoTrack = tracks?.find((t) => t.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
  const audioTrack = tracks?.find((t) => t.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;
  const level = useMicLevel(audioTrack);
  const videoEl = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !videoTrack) return;
    videoTrack.attach(el);
    return () => { videoTrack.detach(el); };
  }, [videoTrack]);

  const cams = useMediaDevices({ kind: 'videoinput' });
  const mics = useMediaDevices({ kind: 'audioinput' });
  const set = (p: Partial<DeviceChoices>) => setChoices((c) => { const n = { ...c, ...p }; if (!observer) savePrefs(n); return n; });

  const s = info.session;
  const canEnter = !info.refusal;
  const joinLabel = observer ? 'Enter silently' : info.role === 'teacher' && s.status !== 'LIVE' ? 'Start class' : 'Join class';

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 lg:grid-cols-[1.3fr_1fr]">
      <div className="grid content-start gap-4">
        <div>
          <p className="text-[13px] text-muted">{info.batch.branch.name} · {info.batch.course}</p>
          <h1 className="text-[22px] font-bold leading-tight">{info.batch.name} · Class {s.position}</h1>
          <p className="text-[14.5px] text-muted">{formatWeekdayDate(s.startsAt)}, {formatTime(s.startsAt)}–{formatTime(s.endsAt)}{info.teacher ? ` · ${info.teacher}` : ''}</p>
          {s.topic && <p className="mt-1 text-[14.5px]">{s.topic}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="brand">You are joining as {LIVE_ROLE_LABELS[info.role]}</Badge>
            {s.status === 'LIVE' && <Badge tone="bad">Live now</Badge>}
          </div>
        </div>

        {observer ? (
          <Card>
            <div className="flex items-start gap-3">
              <Eye className="mt-0.5 h-5 w-5 text-brand" />
              <p className="text-[14.5px]">You will join silently as an observer. Nobody in the class will see you, and your camera and microphone stay off.</p>
            </div>
          </Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <div className="relative aspect-video bg-[#0b1d24]">
              {videoTrack ? (
                <video ref={videoEl} className="h-full w-full -scale-x-100 object-cover" muted playsInline aria-label="Your camera preview" />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-white/70">
                  <CameraOff className="h-8 w-8" />
                  <span className="text-[14px]">{studentCamBlocked ? 'The teacher has turned off student cameras' : 'Camera is off'}</span>
                </div>
              )}
              <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-[13px] text-white">{user?.name}</span>
            </div>
            <div className="grid gap-3 p-4">
              <div className="flex flex-wrap gap-2">
                <Button variant={wantAudio ? 'secondary' : 'danger'} disabled={studentMicBlocked} icon={wantAudio ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />} onClick={() => set({ audio: !choices.audio })} aria-pressed={wantAudio}>
                  {wantAudio ? 'Microphone on' : 'Microphone off'}
                </Button>
                <Button variant={wantVideo ? 'secondary' : 'danger'} disabled={studentCamBlocked} icon={wantVideo ? <Camera className="h-4 w-4" /> : <CameraOff className="h-4 w-4" />} onClick={() => set({ video: !choices.video })} aria-pressed={wantVideo}>
                  {wantVideo ? 'Camera on' : 'Camera off'}
                </Button>
                <Button variant="ghost" icon={<Volume2 className="h-4 w-4" />} onClick={playTestTone}>Test speaker</Button>
              </div>
              {wantAudio && (
                <div>
                  <div className="mb-1 text-[13px] text-muted">Microphone level: speak to test</div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
                    <div className="h-full rounded-full bg-ok transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
                  </div>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {cams.length > 1 && <Select label="Camera" value={choices.videoDeviceId ?? ''} onChange={(e) => set({ videoDeviceId: e.target.value || undefined })} options={cams.map((d, i) => ({ value: d.deviceId, label: d.label || `Camera ${i + 1}` }))} placeholder="Default camera" />}
                {mics.length > 1 && <Select label="Microphone" value={choices.audioDeviceId ?? ''} onChange={(e) => set({ audioDeviceId: e.target.value || undefined })} options={mics.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` }))} placeholder="Default microphone" />}
              </div>
              {deviceError && <Notice tone="warn">{deviceError}</Notice>}
              {studentMicBlocked && <Notice tone="info">The teacher has turned off student microphones for now.</Notice>}
            </div>
          </Card>
        )}
      </div>

      <div className="grid content-start gap-4">
        <Card>
          {canEnter ? (
            <div className="grid gap-3">
              <p className="text-[14.5px]">{s.status === 'LIVE' ? 'The class is running. Join when you are ready.' : info.role === 'teacher' ? 'Students can join from 10 minutes before the start. Start the class when you are ready.' : 'The class is open. The teacher will start soon.'}</p>
              <Button size="md" variant="accent" loading={joining} onClick={() => onJoin({ ...choices, audio: wantAudio, video: wantVideo })}>{joinLabel}</Button>
              {joinError && <Notice tone="bad">{joinError}</Notice>}
            </div>
          ) : (
            <div className="grid gap-2">
              <Notice tone={info.refusal === 'TOO_EARLY' ? 'info' : 'warn'} title={info.refusal === 'TOO_EARLY' ? 'Not open yet' : 'You cannot join'}>
                {info.refusalMessage}
                {info.refusal === 'TOO_EARLY' && <> You can join from <b>{formatTime(info.opensAt)}</b>. This page updates by itself.</>}
              </Notice>
            </div>
          )}
        </Card>
        {info.canManageGuests && <Card><GuestManager sessionId={s.id} /></Card>}
      </div>
    </div>
  );
}
