import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUS, ATT_SOURCE_LABELS, AttStatus, BATCH_MODES, LiveChatMessage, SESSION_STATUS, formatTime, formatWeekdayDate } from '@cc/shared';
import clsx from 'clsx';
import { Lock } from 'lucide-react';
import { ReactNode, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Notice, PageHeader, Spinner, StatusBadge, Tabs, useToast } from '@/components/ui';
import { ApiError, get, put } from '@/lib/api';
import { JoinButton, isJoinable } from '../live/JoinButton';
import { RosterResult, RosterRow, STATUS_TONE, formatMinutes } from './types';

/** Extra tabs on the session page (polls, recordings, boards, performance), registered by later steps. */
export interface SessionTab { id: string; label: string; render: (r: RosterResult) => ReactNode }
export const SESSION_TABS: SessionTab[] = [];

/** T4 Session detail: attendance sheet (roster / overrides), chat log and later polls, recordings, boards. */
export function SessionPage() {
  const { id = '' } = useParams();
  const q = useQuery({ queryKey: ['session-attendance', id], queryFn: () => get<RosterResult>(`/attendance/sessions/${id}`), refetchInterval: (d) => (d.state.data?.session.status === 'LIVE' ? 15_000 : false) });
  const [tab, setTab] = useState('attendance');
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const r = q.data;
  const s = r.session;
  return (
    <>
      <PageHeader
        back={{ to: `/timetable/batch/${r.batch.id}`, label: r.batch.name }}
        title={`${r.batch.name} · Class ${s.position}`}
        subtitle={`${r.batch.course} · ${formatWeekdayDate(s.startsAt)}, ${formatTime(s.startsAt)}–${formatTime(s.endsAt)}`}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand" dot={false}>{BATCH_MODES[r.batch.mode]}</Badge>
          <StatusBadge status={s.status} labels={SESSION_STATUS} />
          {isJoinable(s, r.batch.mode) && <JoinButton sessionId={s.id} label={s.status === 'LIVE' ? 'Join class' : 'Start class'} live={s.status === 'LIVE'} />}
        </div>}
      />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'attendance', label: 'Attendance' }, { id: 'chat', label: 'Chat log' }, ...SESSION_TABS.map((t) => ({ id: t.id, label: t.label }))]} />
      {tab === 'attendance' && <AttendanceSheet data={r} />}
      {tab === 'chat' && <ChatLog sessionId={s.id} />}
      {SESSION_TABS.filter((t) => t.id === tab).map((t) => <div key={t.id}>{t.render(r)}</div>)}
    </>
  );
}

type Draft = Record<string, { status: AttStatus; reason: string; inRoom: boolean }>;

function AttendanceSheet({ data }: { data: RosterResult }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mode = data.batch.mode;
  const s = data.session;
  const started = Date.now() >= new Date(s.startsAt).getTime() - 15 * 60_000;
  const editable = data.canEdit && started && s.status !== 'CANCELLED';
  const rows = data.rows;
  const counts = useMemo(() => {
    const c: Record<string, number> = { PRESENT: 0, LATE: 0, ABSENT: 0, EXCUSED: 0, NONE: 0 };
    rows.forEach((x) => { const st = draft[x.studentId]?.status ?? x.status; c[st ?? 'NONE']++; });
    return c;
  }, [rows, draft]);
  const roster = (row: RosterRow, inRoom: boolean) => mode === 'OFFLINE' || (mode === 'HYBRID' && inRoom);
  const set = (row: RosterRow, p: Partial<Draft[string]>) => setDraft((d) => {
    const cur = d[row.studentId] ?? { status: row.status ?? 'PRESENT', reason: '', inRoom: row.inRoom };
    return { ...d, [row.studentId]: { ...cur, ...p } };
  });
  const save = useMutation({
    mutationFn: () => put<{ changed: number }>(`/attendance/sessions/${s.id}`, {
      marks: Object.entries(draft).map(([studentId, v]) => ({ studentId, status: v.status, inRoom: v.inRoom, ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) })),
    }),
    onSuccess: (r) => { toast(r.changed ? `Attendance saved (${r.changed} changed)` : 'No changes'); setDraft({}); setErrors({}); void qc.invalidateQueries({ queryKey: ['session-attendance', s.id] }); },
    onError: (e) => {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k.replace('reason.', ''), v])));
      toast((e as Error).message, 'bad');
    },
  });
  const allPresent = () => rows.forEach((row) => { if (!row.saved || !draft[row.studentId]) set(row, { status: 'PRESENT', inRoom: mode !== 'ONLINE' }); });
  const dirty = Object.keys(draft).length;

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttStatus[]).map((k) => (
          <Card key={k}><div className="text-[13px] text-muted">{ATTENDANCE_STATUS[k]}</div><div className="text-[24px] font-bold tabular">{counts[k]}</div></Card>
        ))}
      </div>
      {data.locked && (
        <Notice tone="warn" title="Attendance is locked">
          <span className="inline-flex items-center gap-1"><Lock className="h-4 w-4" />Locked {data.lockHours} hours after the class.</span> {data.canEdit ? 'As Branch Admin you can still change it.' : 'Students can send an attendance request; your Branch Admin can change it.'}
        </Notice>
      )}
      {!data.locked && mode !== 'OFFLINE' && !s.finalized && (
        <Notice tone="info">{s.status === 'LIVE' ? 'Attendance so far, from time in class. It is saved automatically when the class ends.' : 'Attendance is worked out from time in class and saved when the class ends.'} Changing an online student needs a reason.</Notice>
      )}
      {mode === 'OFFLINE' && !started && <Notice tone="info">You can mark the roster once the class starts.</Notice>}
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {mode !== 'ONLINE' && <Button variant="secondary" onClick={allPresent}>Mark everyone present</Button>}
        </div>
      )}
      <Card padded={false}>
        {rows.length === 0 ? <Empty title="No students in this batch" /> : (
          <ul className="divide-y divide-line" aria-label="Attendance sheet">
            {rows.map((row) => {
              const d = draft[row.studentId];
              const status = d?.status ?? row.status;
              const inRoom = d?.inRoom ?? row.inRoom;
              const needsReason = !!d && !roster(row, inRoom);
              return (
                <li key={row.studentId} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center" aria-label={row.name}>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{row.name} <span className="text-[13px] font-normal text-muted">{row.code}</span></div>
                    <div className="text-[13px] text-muted">
                      {mode !== 'OFFLINE' && <>{formatMinutes(row.seconds)} in class{row.percent ? ` (${row.percent}%)` : ''}{row.firstJoinAt ? ` · joined ${formatTime(row.firstJoinAt)}` : ''}{row.checkins.opened ? ` · check-ins ${row.checkins.answered}/${row.checkins.opened}` : ''} · </>}
                      {row.source ? ATT_SOURCE_LABELS[row.source] : 'Not marked'}{row.reason ? ` · ${row.reason}` : ''}
                    </div>
                  </div>
                  {mode === 'HYBRID' && editable && <Checkbox label="In the classroom" checked={inRoom} onChange={(e) => set(row, { inRoom: e.target.checked })} />}
                  {editable ? (
                    <div role="radiogroup" aria-label={`Attendance for ${row.name}`} className="flex gap-1">
                      {(['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'] as AttStatus[]).map((k) => (
                        <button
                          key={k} type="button" role="radio" aria-checked={status === k} onClick={() => set(row, { status: k })}
                          className={clsx('rounded-lg border px-2.5 py-1.5 text-[13px] font-semibold', status === k ? {
                            'border-ok bg-ok text-white': k === 'PRESENT', 'border-warn bg-warn text-white': k === 'LATE', 'border-bad bg-bad text-white': k === 'ABSENT', 'border-info bg-info text-white': k === 'EXCUSED',
                          } : 'border-line hover:bg-surface-2')}
                        >{ATTENDANCE_STATUS[k]}</button>
                      ))}
                    </div>
                  ) : status ? <Badge tone={STATUS_TONE[status]}>{ATTENDANCE_STATUS[status]}</Badge> : <span className="text-[13px] text-muted">Not marked</span>}
                  {needsReason && (
                    <div className="md:w-56">
                      <label className="sr-only" htmlFor={`reason-${row.studentId}`}>Reason for {row.name}</label>
                      <input id={`reason-${row.studentId}`} value={d.reason} onChange={(e) => set(row, { reason: e.target.value })} placeholder="Reason (required)" className={clsx('input w-full', errors[row.studentId] && 'border-bad')} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {editable && dirty > 0 && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <span className="px-2 text-[14px]">{dirty} change{dirty === 1 ? '' : 's'}</span>
            <Button variant="secondary" onClick={() => { setDraft({}); setErrors({}); }}>Discard</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save attendance</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatLog({ sessionId }: { sessionId: string }) {
  const q = useQuery({ queryKey: ['chat-log', sessionId], queryFn: () => get<LiveChatMessage[]>(`/live/sessions/${sessionId}/chat`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data?.length) return <Card><Empty title="No chat messages in this class" /></Card>;
  return (
    <Card>
      <ol className="grid gap-3" aria-label="Chat log">
        {q.data.map((m) => (
          <li key={m.id} className="text-[14.5px]">
            <div className="text-[13px] text-muted"><b className="text-fg">{m.name}</b>{m.role === 'teacher' ? ' · Teacher' : ''} · {formatTime(m.createdAt)}</div>
            <p className="whitespace-pre-wrap break-words">{m.text}</p>
          </li>
        ))}
      </ol>
    </Card>
  );
}
