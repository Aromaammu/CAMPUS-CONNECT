import '@excalidraw/excalidraw/index.css';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import { useRoomContext } from '@livekit/components-react';
import { LiveRoomState } from '@cc/shared';
import { Save } from 'lucide-react';
import { Participant, RoomEvent } from 'livekit-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/ui';
import { upload } from '@/lib/api';
import { roleOf } from './Room';

// Fonts come from our own site (see vite.config.ts), never a public CDN.
(window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw-assets/`;

type El = { id: string; version: number; versionNonce: number; isDeleted?: boolean } & Record<string, unknown>;
type Api = {
  getSceneElementsIncludingDeleted: () => readonly El[];
  updateScene: (s: { elements: El[] }) => void;
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
};
type Packet = { t: 'els'; els: El[] } | { t: 'req' };

const MAX_BYTES = 14_000; // keep each class-room message small
const enc = new TextEncoder();

/**
 * Shared whiteboard (PRD §7.2). The teacher and anyone given the pen draw; everyone else watches.
 * Changes travel over the class connection; someone joining late asks for the current board.
 */
export default function Whiteboard({ sessionId, state, isTeacher, myId, canSave = true }: { sessionId: string; state: LiveRoomState; isTeacher: boolean; myId: string; canSave?: boolean }) {
  const room = useRoomContext();
  const toast = useToast();
  const api = useRef<Api | null>(null);
  const sent = useRef(new Map<string, number>());
  const queue = useRef(new Map<string, El>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [saving, setSaving] = useState(false);
  const canDraw = isTeacher || state.penUserIds.includes(myId);
  const stateRef = useRef(state);
  stateRef.current = state;

  const publish = useCallback((els: El[], to?: string[]) => {
    let batch: El[] = [];
    let size = 0;
    const flush = () => {
      if (!batch.length) return;
      void room.localParticipant.publishData(enc.encode(JSON.stringify({ t: 'els', els: batch } satisfies Packet)), { reliable: true, topic: 'wb', ...(to ? { destinationIdentities: to } : {}) });
      batch = []; size = 0;
    };
    for (const e of els) {
      const n = JSON.stringify(e).length;
      if (size + n > MAX_BYTES) flush();
      batch.push(e); size += n;
    }
    flush();
  }, [room]);

  const onChange = useCallback((elements: readonly El[]) => {
    if (!canDraw) return;
    for (const e of elements) {
      if (sent.current.get(e.id) !== e.version) { queue.current.set(e.id, e); sent.current.set(e.id, e.version); }
    }
    if (!queue.current.size || timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      const els = [...queue.current.values()];
      queue.current.clear();
      publish(els);
    }, 120);
  }, [canDraw, publish]);

  useEffect(() => {
    const allowed = (p?: Participant) => !!p && (roleOf(p) === 'teacher' || stateRef.current.penUserIds.includes(p.identity));
    const onData = (payload: Uint8Array, p?: Participant, _k?: unknown, topic?: string) => {
      if (topic !== 'wb' || !api.current) return;
      let msg: Packet;
      try { msg = JSON.parse(new TextDecoder().decode(payload)) as Packet; } catch { return; }
      if (msg.t === 'req') {
        // Whoever can draw answers a late joiner with the whole board.
        if (canDraw && p) publish([...api.current.getSceneElementsIncludingDeleted()], [p.identity]);
        return;
      }
      if (!allowed(p)) return; // ignore drawing from people without the pen
      const current = new Map(api.current.getSceneElementsIncludingDeleted().map((e) => [e.id, e]));
      let changed = false;
      for (const e of msg.els) {
        const mine = current.get(e.id);
        if (!mine || e.version > mine.version || (e.version === mine.version && e.versionNonce < mine.versionNonce)) {
          current.set(e.id, e); sent.current.set(e.id, e.version); changed = true;
        }
      }
      if (changed) api.current.updateScene({ elements: [...current.values()] });
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
  }, [room, canDraw, publish]);

  const ready = useCallback((a: Api) => {
    api.current = a;
    // Ask for the board as it is now.
    void room.localParticipant.publishData(enc.encode(JSON.stringify({ t: 'req' } satisfies Packet)), { reliable: true, topic: 'wb' });
  }, [room]);

  const save = async () => {
    if (!api.current) return;
    setSaving(true);
    try {
      const elements = api.current.getSceneElementsIncludingDeleted().filter((e) => !e.isDeleted);
      if (!elements.length) { toast('The board is empty', 'bad'); return; }
      const blob = await exportToBlob({ elements: elements as never, appState: { ...api.current.getAppState(), exportBackground: true, viewBackgroundColor: '#ffffff' } as never, files: api.current.getFiles() as never, mimeType: 'image/png' });
      const fd = new FormData();
      fd.append('file', blob, 'whiteboard.png');
      await upload(`/live/sessions/${sessionId}/boards`, fd);
      toast('Board saved to the class materials');
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg bg-white text-[#1b1b1b]" aria-label="Whiteboard">
      <div className="flex items-center justify-between gap-2 border-b border-black/10 bg-[#f5f7f8] px-3 py-1.5 text-[13px]">
        <span className="font-semibold">{canDraw ? (isTeacher ? 'Whiteboard: you are drawing' : 'You have the pen') : 'Whiteboard: the teacher is drawing'}</span>
        {isTeacher && canSave && (
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex items-center gap-1.5 rounded-md bg-[#0E3B47] px-2.5 py-1 font-semibold text-white disabled:opacity-50">
            <Save className="h-3.5 w-3.5" />Save to class materials
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <Excalidraw
          excalidrawAPI={(a) => ready(a as unknown as Api)}
          onChange={(els) => onChange(els as unknown as readonly El[])}
          viewModeEnabled={!canDraw}
          theme="light"
          UIOptions={{ tools: { image: false }, canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: false } }}
        />
      </div>
    </div>
  );
}
