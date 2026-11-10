import { useRoomContext } from '@livekit/components-react';
import { LIVE_ROLE_LABELS, LiveChatMessage, formatTime } from '@cc/shared';
import { Send, X } from 'lucide-react';
import { RoomEvent } from 'livekit-client';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from '@/lib/api';
import { liveBase } from './types';
import type { JoinResult, LiveInfo } from './types';

/** Class chat: history from the server, new messages over the class connection. */
export function useClassChat(base: string, onNew: (m: LiveChatMessage) => void) {
  const room = useRoomContext();
  const [messages, setMessages] = useState<LiveChatMessage[]>([]);
  const add = useCallback((m: LiveChatMessage) => setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m])), []);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;
  useEffect(() => {
    let alive = true;
    get<LiveChatMessage[]>(`${base}/chat`).then((h) => { if (alive) setMessages((cur) => [...h, ...cur.filter((c) => !h.some((x) => x.id === c.id))]); }).catch(() => undefined);
    const onData = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic !== 'chat') return;
      try {
        const m = JSON.parse(new TextDecoder().decode(payload)) as LiveChatMessage;
        add(m);
        onNewRef.current(m);
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { alive = false; room.off(RoomEvent.DataReceived, onData); };
  }, [room, base, add]);
  return { messages, add };
}

export function ChatPanel({ info, join, chatDisabled, messages, onSent, onClose }: {
  info: LiveInfo; join: JoinResult; chatDisabled: boolean; messages: LiveChatMessage[]; onSent: (m: LiveChatMessage) => void; onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const blocked = (chatDisabled && join.role === 'student') || (join.role === 'observer' && !join.isHost);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError(null);
    try {
      onSent(await post<LiveChatMessage>(`${liveBase(info)}/chat`, { text: t }));
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[15px] font-bold">Class chat</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close chat"><X className="h-5 w-5" /></button>
      </div>
      <ol ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-label="Chat messages">
        {messages.length === 0 && <li className="py-6 text-center text-[14px] text-white/60">No messages yet. Messages are saved with this class.</li>}
        {messages.map((m) => (
          <li key={m.id} className="text-[14.5px]">
            <div className="flex items-baseline gap-1.5 text-[12.5px] text-white/60">
              <span className="font-semibold text-white/90">{m.userId === join.identity ? 'You' : m.name}</span>
              {m.role === 'teacher' && <span className="rounded bg-[#C77C12]/30 px-1 text-[11px] font-bold uppercase text-[#ffcf8a]">{LIVE_ROLE_LABELS.teacher}</span>}
              <span>{formatTime(m.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="border-t border-white/10 p-2">
        {chatDisabled && <p className="px-1 pb-1.5 text-[13px] text-[#ffcf8a]">{join.role === 'student' ? 'The teacher has turned off chat.' : 'Student chat is off. Only teachers can write.'}</p>}
        {error && <p className="px-1 pb-1.5 text-[13px] text-[#ff8a8a]" role="alert">{error}</p>}
        <div className="flex gap-2">
          <label htmlFor="class-chat-input" className="sr-only">Message</label>
          <input
            id="class-chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={blocked}
            maxLength={1000}
            placeholder={blocked ? 'Chat is off' : 'Write a message'}
            autoComplete="off"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[14.5px] text-white placeholder:text-white/40 focus:border-[#C77C12] focus:outline-none disabled:opacity-50"
          />
          <button type="submit" disabled={blocked || !text.trim() || sending} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[#C77C12] disabled:opacity-40" aria-label="Send message"><Send className="h-4 w-4" /></button>
        </div>
      </form>
    </>
  );
}
