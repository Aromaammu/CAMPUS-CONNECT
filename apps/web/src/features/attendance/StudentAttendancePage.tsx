import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUS, ATT_REQUEST_REASONS, ATT_REQUEST_STATUS, AttStatus, formatTime, formatWeekdayDate } from '@cc/shared';
import { ClipboardCheck, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '@/components/ui';
import { ApiError, get, post, upload } from '@/lib/api';
import { STATUS_TONE, formatMinutes } from './types';

interface MySession {
  sessionId: string; position: number; startsAt: string; endsAt: string; status: string;
  attendance: { status: AttStatus; source: string; reason: string | null; attendedSeconds: number } | null;
  request: { id: string; status: keyof typeof ATT_REQUEST_STATUS; decisionNote: string | null; createdAt: string } | null;
  canRequest: boolean;
}
interface MyBatch {
  enrolmentId: string; enrolmentStatus: string; percent: number | null;
  batch: { id: string; name: string; course: string; branch: { code: string; name: string } };
  counts: { present: number; late: number; absent: number; excused: number };
  sessions: MySession[];
}

/** S5 Attendance & requests. */
export function StudentAttendancePage() {
  const q = useQuery({ queryKey: ['my-attendance'], queryFn: () => get<{ requestDays: number; batches: MyBatch[] }>('/me/attendance') });
  const [asking, setAsking] = useState<{ batch: MyBatch; s: MySession } | null>(null);
  return (
    <>
      <PageHeader title="Attendance" subtitle="Your attendance in every batch. Missed being marked? Send a request to your teacher." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.batches.length ? (
        <Card><Empty title="No attendance yet" icon={<ClipboardCheck className="h-8 w-8" />}>Your attendance appears here after your first class.</Empty></Card>
      ) : (
        <div className="grid gap-5">
          {q.data.batches.map((b) => (
            <Card key={b.enrolmentId} title={<span>{b.batch.course} <span className="font-normal text-muted">· {b.batch.name} · {b.batch.branch.code}</span></span>}>
              <div className="mb-4 flex flex-wrap items-end gap-5">
                <div>
                  <div className="text-[13px] text-muted">Attendance</div>
                  <div className={`text-[30px] font-bold tabular ${b.percent !== null && b.percent < 75 ? 'text-bad' : ''}`}>{b.percent === null ? '–' : `${b.percent}%`}</div>
                </div>
                <div className="flex flex-wrap gap-2 text-[14px]">
                  <Badge tone="ok">Present {b.counts.present}</Badge><Badge tone="warn">Late {b.counts.late}</Badge><Badge tone="bad">Absent {b.counts.absent}</Badge><Badge tone="info">Excused {b.counts.excused}</Badge>
                </div>
              </div>
              {b.sessions.length === 0 ? <p className="text-[14px] text-muted">No classes yet.</p> : (
                <ul className="divide-y divide-line" aria-label={`Classes in ${b.batch.name}`}>
                  {b.sessions.map((s) => (
                    <li key={s.sessionId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14.5px] font-semibold">Class {s.position} · {formatWeekdayDate(s.startsAt)}, {formatTime(s.startsAt)}</span>
                        <span className="block text-[13px] text-muted">
                          {s.attendance ? `${s.attendance.attendedSeconds ? `${formatMinutes(s.attendance.attendedSeconds)} in class` : ''}${s.attendance.reason ? `${s.attendance.attendedSeconds ? ' · ' : ''}${s.attendance.reason}` : ''}` : s.status === 'LIVE' ? 'Class is running' : 'Not marked yet'}
                          {s.request && <> · Request: <b>{ATT_REQUEST_STATUS[s.request.status]}</b>{s.request.decisionNote ? ` (${s.request.decisionNote})` : ''}</>}
                        </span>
                      </span>
                      {s.attendance && <Badge tone={STATUS_TONE[s.attendance.status]}>{ATTENDANCE_STATUS[s.attendance.status]}</Badge>}
                      {s.canRequest && <Button size="sm" variant="secondary" onClick={() => setAsking({ batch: b, s })}>Request attendance</Button>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[13px] text-muted">You can request attendance within {q.data.requestDays} days of a class.</p>
            </Card>
          ))}
        </div>
      )}
      {asking && <RequestDialog batch={asking.batch} session={asking.s} onClose={() => setAsking(null)} />}
    </>
  );
}

function RequestDialog({ batch, session, onClose }: { batch: MyBatch; session: MySession; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => post('/attendance/requests', { sessionId: session.sessionId, reason, ...(note.trim() ? { note: note.trim() } : {}), ...(file ? { attachmentId: file.id } : {}) }),
    onSuccess: () => { toast('Request sent to your teacher'); void qc.invalidateQueries({ queryKey: ['my-attendance'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); },
  });
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      setFile(await upload<{ id: string; name: string }>('/attendance/requests/attachment', fd));
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setUploading(false); }
  };
  return (
    <Modal open onClose={onClose} title="Request attendance" size="md" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={send.isPending} disabled={!reason || uploading} onClick={() => send.mutate()}>Send request</Button>
    </>}>
      <div className="grid gap-4">
        <p className="text-[14.5px]">{batch.batch.name}, class {session.position} on {formatWeekdayDate(session.startsAt)}. Your teacher will approve or reject it.</p>
        <Select label="Reason" required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Choose a reason" options={ATT_REQUEST_REASONS.map((r) => ({ value: r, label: r }))} error={errors.reason} />
        <Textarea label="More details (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
        <div>
          <label htmlFor="att-shot" className="mb-1 block text-[14px] font-semibold">Screenshot (optional)</label>
          <input id="att-shot" type="file" accept="image/*,application/pdf" onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-[14px] file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold" />
          {uploading && <p className="mt-1 text-[13px] text-muted">Uploading…</p>}
          {file && <p className="mt-1 inline-flex items-center gap-1 text-[13px] text-ok"><Paperclip className="h-3.5 w-3.5" />{file.name} attached</p>}
          <p className="mt-1 text-[12.5px] text-muted">An image or PDF up to 5 MB.</p>
        </div>
      </div>
    </Modal>
  );
}
