import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FEEDBACK_AREAS, FEEDBACK_AREA_LABELS, FEEDBACK_KIND, PERFORMANCE_LABELS, formatDate } from '@cc/shared';
import clsx from 'clsx';
import { MessageSquarePlus } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, Empty, ErrorBox, Modal, Spinner, Tabs, Textarea, useToast } from '@/components/ui';
import { ApiError, get, post, put } from '@/lib/api';
import type { BatchDetail } from '../academics/types';
import type { RosterResult } from '../attendance/types';

/** 1–5 buttons used for marks and ratings. */
export function Scale({ value, onChange, label, max = 5 }: { value: number | null; onChange: (v: number) => void; label: string; max?: number }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}${PERFORMANCE_LABELS[n] ? ` – ${PERFORMANCE_LABELS[n]}` : ''}`} onClick={() => onChange(n)}
          className={clsx('h-9 w-9 rounded-lg border text-[14px] font-bold', value === n ? 'border-brand bg-brand text-brand-fg' : 'border-line hover:bg-surface-2')}>{n}</button>
      ))}
    </div>
  );
}

/** Session page tab (PRD §9.2): quick-entry grid of marks and remarks. */
export function MarksTab({ data }: { data: RosterResult }) {
  const qc = useQueryClient();
  const toast = useToast();
  const id = data.session.id;
  const q = useQuery({ queryKey: ['marks', id], queryFn: () => get<{ canEdit: boolean; rows: { studentId: string; name: string; code: string; mark: number | null; remark: string | null }[] }>(`/performance/sessions/${id}`) });
  const [draft, setDraft] = useState<Record<string, { mark: number | null; remark: string }>>({});
  const save = useMutation({
    mutationFn: () => put(`/performance/sessions/${id}`, { marks: Object.entries(draft).map(([studentId, v]) => ({ studentId, mark: v.mark, remark: v.remark || undefined })) }),
    onSuccess: () => { toast('Marks saved'); setDraft({}); void qc.invalidateQueries({ queryKey: ['marks', id] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data.canEdit) return <Card><Empty title="Marks can be given once the class has started" /></Card>;
  const dirty = Object.keys(draft).length;
  return (
    <div className="grid gap-3">
      <p className="text-[14px] text-muted">1 Needs help · 2 Below average · 3 Average · 4 Good · 5 Excellent. Students see their marks and a running average.</p>
      <Card padded={false}>
        <ul className="divide-y divide-line" aria-label="Marks">
          {q.data.rows.map((r) => {
            const d = draft[r.studentId];
            const mark = d ? d.mark : r.mark;
            const set = (p: Partial<{ mark: number | null; remark: string }>) => setDraft((x) => ({ ...x, [r.studentId]: { mark, remark: d?.remark ?? r.remark ?? '', ...p } }));
            return (
              <li key={r.studentId} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center" aria-label={r.name}>
                <div className="min-w-0 flex-1 font-semibold">{r.name} <span className="text-[13px] font-normal text-muted">{r.code}</span></div>
                <Scale label={`Mark for ${r.name}`} value={mark} onChange={(v) => set({ mark: v })} />
                <input aria-label={`Remark for ${r.name}`} className="input md:w-56" placeholder="Remark (optional)" maxLength={300} value={d?.remark ?? r.remark ?? ''} onChange={(e) => set({ remark: e.target.value })} />
              </li>
            );
          })}
        </ul>
      </Card>
      {dirty > 0 && (
        <div className="sticky bottom-3 z-10 flex justify-end">
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-2 shadow-lg">
            <Button variant="secondary" onClick={() => setDraft({})}>Discard</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>Save marks</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Batch page tab for teachers: each student's average and a way to give feedback. */
export function ProgressTab({ batch }: { batch: BatchDetail }) {
  const q = useQuery({ queryKey: ['batch-performance', batch.id], queryFn: () => get<{ studentId: string; name: string; code: string; average: number | null; marked: number }[]>(`/batches/${batch.id}/performance`) });
  const [giving, setGiving] = useState<{ studentId: string; name: string } | null>(null);
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data.length) return <Card><Empty title="No students yet" /></Card>;
  return (
    <>
      <Card padded={false}>
        <ul className="divide-y divide-line" aria-label="Student progress">
          {q.data.map((s) => (
            <li key={s.studentId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{s.name} <span className="text-[13px] font-normal text-muted">{s.code}</span></div>
                <div className="text-[13px] text-muted">{s.average === null ? 'No marks yet' : `Average ${s.average} of 5 over ${s.marked} classes`}</div>
              </div>
              <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setGiving({ studentId: s.studentId, name: s.name })}>Give feedback</Button>
            </li>
          ))}
        </ul>
      </Card>
      {giving && <FeedbackDialog batchId={batch.id} student={giving} onClose={() => setGiving(null)} />}
    </>
  );
}

function FeedbackDialog({ batchId, student, onClose }: { batchId: string; student: { studentId: string; name: string }; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<'TEACHER_NOTE' | 'TEACHER_MID' | 'TEACHER_END'>('TEACHER_NOTE');
  const [comment, setComment] = useState('');
  const [ratings, setRatings] = useState<Record<string, number | null>>({ understanding: null, practice: null, participation: null, punctuality: null });
  const [error, setError] = useState<string | null>(null);
  const history = useQuery({ queryKey: ['feedback-given', batchId, student.studentId], queryFn: () => get<{ id: string; kind: keyof typeof FEEDBACK_KIND; comment: string | null; createdAt: string; from: { name: string } }[]>(`/batches/${batchId}/feedback`, { studentId: student.studentId }) });
  const send = useMutation({
    mutationFn: () => post('/feedback/teacher', kind === 'TEACHER_NOTE' ? { kind, batchId, studentId: student.studentId, comment } : { kind, batchId, studentId: student.studentId, ratings, comment: comment || undefined }),
    onSuccess: () => { toast(`Feedback sent to ${student.name}`); void qc.invalidateQueries({ queryKey: ['feedback-given', batchId, student.studentId] }); onClose(); },
    onError: (e) => { setError(e instanceof ApiError ? e.message : 'Could not send'); },
  });
  const formReady = kind === 'TEACHER_NOTE' ? comment.trim().length >= 3 : Object.values(ratings).every((v) => v !== null);
  return (
    <Modal open onClose={onClose} title={`Feedback for ${student.name}`} size="md" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={send.isPending} disabled={!formReady} onClick={() => send.mutate()}>Send feedback</Button>
    </>}>
      <div className="grid gap-4">
        <Tabs value={kind} onChange={setKind} tabs={[{ id: 'TEACHER_NOTE', label: 'Note' }, { id: 'TEACHER_MID', label: 'Mid-course' }, { id: 'TEACHER_END', label: 'End of course' }]} />
        {kind !== 'TEACHER_NOTE' && FEEDBACK_AREAS.map((a) => (
          <div key={a} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14.5px] font-semibold">{FEEDBACK_AREA_LABELS[a]}</span>
            <Scale label={FEEDBACK_AREA_LABELS[a]} value={ratings[a]} onChange={(v) => setRatings((r) => ({ ...r, [a]: v }))} />
          </div>
        ))}
        <Textarea label={kind === 'TEACHER_NOTE' ? 'Feedback' : 'Comments (optional)'} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} rows={4} />
        {error && <p className="text-[13.5px] text-bad" role="alert">{error}</p>}
        {!!history.data?.length && (
          <div>
            <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Earlier feedback</h3>
            <ul className="grid gap-1.5 text-[13.5px]">
              {history.data.slice(0, 5).map((f) => <li key={f.id}><b>{formatDate(f.createdAt)} · {FEEDBACK_KIND[f.kind]}</b>{f.comment ? `: ${f.comment}` : ''}</li>)}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
