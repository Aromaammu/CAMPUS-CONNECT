import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';

/** One live connection per tab (new messages, typing, read receipts, notifications). */
let socket: Socket | null = null;

export function connectRealtime(): Socket {
  if (socket) return socket;
  const s = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
  // The access cookie lasts 15 minutes: refresh it and reconnect.
  s.on('auth-expired', async () => {
    const ok = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include', headers: { 'x-cc': '1' } }).then((r) => r.ok).catch(() => false);
    if (ok) setTimeout(() => s.connect(), 500);
  });
  socket = s;
  return s;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function emitRealtime(event: string, payload: unknown) {
  socket?.emit(event, payload);
}

/** Listen to a live event while the component is on screen. */
export function useRealtime<T>(event: string, handler: (payload: T) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const s = connectRealtime();
    const fn = (p: T) => ref.current(p);
    s.on(event, fn);
    return () => { s.off(event, fn); };
  }, [event, enabled]);
}
