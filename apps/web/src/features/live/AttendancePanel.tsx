import { useQuery } from '@tanstack/react-query';
import { ATTENDANCE_STATUS } from '@cc/shared';
import { ClipboardCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import type { RosterResult } from '../attendance/types';
import { formatMinutes } from '../attendance/types';
import type { LiveInfo } from './types';

const CHIP: Record<string, string> = { PRESENT: 'bg-[#1f7a4d]', LATE: 'bg-[#b06c0e]', ABSENT: 'bg-[#a33a3a]', EXCUSED: 'bg-[#2f5f8a]' };

export function useCountdown(until: string | null | undefined) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  return until ? Math.max(0, Math.ceil((new Date(until).getTime() - now) / 1000)) : 0;
}

/** Teacher's live attendance panel (PRD §7.2): status so far for every enrolled student, and check-ins. */
export function AttendancePanel({ info, onClose }: { info: LiveInfo; onClose: () => void }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['live-attendance', info.session.id], queryFn: () => get<RosterResult>(`/attendance/sessions/${info.session.id}`), refetchInterval: 10_000 });
  const open = q.data?.checkins.find((c) => c.open);
  const left = useCountdown(open?.closesAt);
  useEffect(() => { if (open && left === 0) void q.refetch(); }, [open, left, q]);
  const [busy, setBusy] = useState(false);
  const ask = async () => {
    setBusy(true);
    try { await post(`/attendance/sessions/${info.session.id}/checkins`); toast('Students were asked to check in'); await q.refetch(); }
    catch (e) { toast((e as Error).message, 'bad'); }
    finally { setBusy(false); }
  };
  const rows = q.data?.rows ?? [];
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[15px] font-bold">Attendance</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close attendance"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mb-3 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/5 p-2"><div className="text-[20px] font-bold tabular-nums">{count('PRESENT')}</div><div className="text-[12px] text-white/60">Present so far</div></div>
          <div className="rounded-lg bg-white/5 p-2"><div className="text-[20px] font-bold tabular-nums">{count('LATE')}</div><div className="text-[12px] text-white/60">Late</div></div>
          <div className="rounded-lg bg-white/5 p-2"><div className="text-[20px] font-bold tabular-nums">{count('ABSENT')}</div><div className="text-[12px] text-white/60">Not enough yet</div></div>
        </div>
        <div className="mb-3 rounded-lg border border-white/10 p-3">
          {open ? (
            <p className="text-[14px]" role="status"><b>Check-in open:</b> {left}s left · {open.answered} of {rows.length} answered</p>
          ) : (
            <button type="button" disabled={busy} onClick={ask} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C77C12] px-3 py-2 text-[14px] font-bold disabled:opacity-50">
              <ClipboardCheck className="h-4 w-4" />Ask students to check in
            </button>
          )}
          <p className="mt-1.5 text-[12.5px] text-white/60">
            {q.data?.batch.checkinRequired ? 'Check-ins are required in this batch: students must answer every one to be Present.' : 'Check-ins are extra in this batch: attendance comes from time in class.'}
            {q.data && q.data.checkins.length > 0 && ` ${q.data.checkins.length} so far.`}
          </p>
        </div>
        {q.isLoading ? <p className="text-[13px] text-white/60">Loading…</p> : q.error ? <p className="text-[13px] text-[#ff8a8a]">{(q.error as Error).message}</p> : (
          <ul className="grid gap-1" aria-label="Live attendance">
            {rows.map((r) => (
              <li key={r.studentId} className="flex items-center gap-2 rounded-lg px-1 py-1.5 text-[14px]">
                <span className={`h-2 w-2 shrink-0 rounded-full ${r.inRoomNow ? 'bg-[#4ade80]' : 'bg-white/25'}`} aria-label={r.inRoomNow ? 'In class now' : 'Not in class now'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{r.name}</span>
                  <span className="block text-[12px] text-white/60">{formatMinutes(r.seconds)} · {r.percent}%{r.checkins.opened > 0 ? ` · check-ins ${r.checkins.answered}/${r.checkins.opened}` : ''}</span>
                </span>
                {r.status && <span className={`rounded px-1.5 py-0.5 text-[12px] font-bold ${CHIP[r.status]}`}>{ATTENDANCE_STATUS[r.status]}</span>}
              </li>
            ))}
          </ul>
        )}
        <Link to={`/sessions/${info.session.id}`} target="_blank" className="mt-4 inline-block text-[13.5px] font-semibold text-[#ffcf8a] hover:underline">Open the full attendance sheet</Link>
      </div>
    </>
  );
}

/** Student side of a check-in: "Mark your attendance" with a countdown. */
export function CheckinPrompt({ sessionId, windowId, closesAt, onDone }: { sessionId: string; windowId: string; closesAt: string; onDone: () => void }) {
  const left = useCountdown(closesAt);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (left === 0) onDone(); }, [left, onDone]);
  const answer = async () => {
    setBusy(true);
    try { await post(`/attendance/checkins/${windowId}`); toast('You are checked in'); onDone(); }
    catch (e) { toast((e as Error).message, 'bad'); }
    finally { setBusy(false); }
  };
  return (
    <div role="alertdialog" aria-label="Mark your attendance" data-session={sessionId} className="absolute left-1/2 top-4 z-30 w-[min(92vw,360px)] -translate-x-1/2 rounded-xl bg-[#173640] p-4 text-center shadow-2xl ring-2 ring-[#C77C12]">
      <p className="text-[16px] font-bold">Mark your attendance</p>
      <p className="mt-1 text-[14px] text-white/70">The teacher is checking who is here. {left}s left.</p>
      <button type="button" disabled={busy} onClick={answer} className="mt-3 w-full rounded-lg bg-[#C77C12] px-4 py-2.5 text-[15px] font-bold disabled:opacity-50">I&apos;m present</button>
    </div>
  );
}
