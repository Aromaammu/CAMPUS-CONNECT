import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COURSE_FEEDBACK_AREAS, COURSE_FEEDBACK_AREA_LABELS, FEEDBACK_AREA_LABELS, FEEDBACK_KIND, PERFORMANCE_LABELS, PROJECT_STATUS, formatDate, formatWeekdayDate } from '@cc/shared';
import clsx from 'clsx';
import { Download, ExternalLink, FolderKanban, Paperclip, Star } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, PageHeader, Spinner, StatusBadge, Textarea, useToast } from '@/components/ui';
import { ApiError, download, get, post, upload } from '@/lib/api';
import { Scale } from './ProgressTabs';

/** Five tappable stars. */
export function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => onChange(n)} className="rounded p-0.5 hover:bg-surface-2">
          <Star className={clsx('h-7 w-7', n <= value ? 'fill-accent text-accent' : 'text-line')} />
        </button>
      ))}
    </div>
  );
}

interface PerfBatch {
  batch: { id: string; name: string; course: string; branch: string }; average: number | null;
  marks: { sessionId: string; position: number; startsAt: string; mark: number; remark: string | null }[];
  feedback: { id: string; kind: keyof typeof FEEDBACK_KIND; from: string; comment: string | null; ratings: Record<string, number> | null; createdAt: string }[];
  courseFeedback: { ratings: Record<string, number>; comment: string | null; createdAt: string } | null;
}
interface DueClass { id: string; position: number; startsAt: string; batch: { id: string; name: string; course: { name: string } } }

/** S6 Performance & feedback. */
export function StudentPerformancePage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-performance'], queryFn: () => get<PerfBatch[]>('/me/performance') });
  const due = useQuery({ queryKey: ['feedback-due'], queryFn: () => get<DueClass[]>('/me/feedback-due') });
  const [course, setCourse] = useState<PerfBatch | null>(null);
  return (
    <>
      <PageHeader title="Performance & feedback" subtitle="Your marks in each class, feedback from your teachers, and your ratings."
        actions={<Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void download('/reports/students/me/performance.pdf').catch((e) => toast((e as Error).message, 'bad'))}>Download report (PDF)</Button>} />
      {!!due.data?.length && (
        <Card title="Rate your recent classes" className="mb-5">
          <ul className="divide-y divide-line">{due.data.map((c) => <RateClass key={c.id} c={c} />)}</ul>
        </Card>
      )}
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title="Nothing yet" /></Card> : (
        <div className="grid gap-5">
          {q.data.map((b) => (
            <Card key={b.batch.id} title={<span>{b.batch.course} <span className="font-normal text-muted">· {b.batch.name} · {b.batch.branch}</span></span>}
              actions={<Button size="sm" variant="secondary" onClick={() => setCourse(b)}>{b.courseFeedback ? 'Edit course feedback' : 'Give course feedback'}</Button>}>
              <div className="mb-3">
                <div className="text-[13px] text-muted">Average mark</div>
                <div className="text-[28px] font-bold tabular">{b.average === null ? '–' : <>{b.average}<span className="text-[16px] font-semibold text-muted"> / 5</span></>}</div>
              </div>
              {b.feedback.length > 0 && (
                <div className="mb-4 grid gap-2">
                  <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">From your teachers</h3>
                  {b.feedback.map((f) => (
                    <div key={f.id} className="rounded-lg bg-surface-2 p-3 text-[14.5px]">
                      <div className="text-[13px] text-muted">{FEEDBACK_KIND[f.kind]} · {f.from} · {formatDate(f.createdAt)}</div>
                      {f.ratings && <div className="mt-1 flex flex-wrap gap-2">{Object.entries(f.ratings).map(([k, v]) => <Badge key={k} tone="brand" dot={false}>{FEEDBACK_AREA_LABELS[k as keyof typeof FEEDBACK_AREA_LABELS] ?? k} {v}/5</Badge>)}</div>}
                      {f.comment && <p className="mt-1">{f.comment}</p>}
                    </div>
                  ))}
                </div>
              )}
              {b.marks.length ? (
                <ul className="divide-y divide-line" aria-label={`Marks in ${b.batch.name}`}>
                  {b.marks.map((m) => (
                    <li key={m.sessionId} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1 text-[14.5px]">Class {m.position} · {formatWeekdayDate(m.startsAt)}{m.remark && <span className="block text-[13px] text-muted">{m.remark}</span>}</span>
                      <Badge tone={m.mark >= 4 ? 'ok' : m.mark === 3 ? 'info' : 'warn'} dot={false}>{m.mark} · {PERFORMANCE_LABELS[m.mark]}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-muted">No marks yet.</p>}
            </Card>
          ))}
        </div>
      )}
      {course && <CourseFeedback b={course} onClose={() => setCourse(null)} />}
    </>
  );
}

function RateClass({ c }: { c: DueClass }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const send = useMutation({
    mutationFn: () => post(`/feedback/sessions/${c.id}/rating`, { rating, comment: comment || undefined }),
    onSuccess: () => { toast('Thanks for your rating'); void qc.invalidateQueries({ queryKey: ['feedback-due'] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <li className="flex flex-col gap-2 py-3 md:flex-row md:items-center" aria-label={`Rate class ${c.position} of ${c.batch.name}`}>
      <span className="min-w-0 flex-1 text-[14.5px]"><b>{c.batch.course.name}</b> · {c.batch.name}, class {c.position} ({formatWeekdayDate(c.startsAt)})</span>
      <Stars value={rating} onChange={setRating} label={`Rating for class ${c.position}`} />
      {rating > 0 && <input className="input md:w-52" placeholder="Comment (optional)" aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} />}
      <Button size="sm" disabled={!rating} loading={send.isPending} onClick={() => send.mutate()}>Send</Button>
    </li>
  );
}

function CourseFeedback({ b, onClose }: { b: PerfBatch; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [ratings, setRatings] = useState<Record<string, number | null>>(() => Object.fromEntries(COURSE_FEEDBACK_AREAS.map((a) => [a, b.courseFeedback?.ratings?.[a] ?? null])));
  const [comment, setComment] = useState(b.courseFeedback?.comment ?? '');
  const send = useMutation({
    mutationFn: () => post('/feedback/course', { batchId: b.batch.id, ratings, comment: comment || undefined }),
    onSuccess: () => { toast('Thank you for your feedback'); void qc.invalidateQueries({ queryKey: ['my-performance'] }); onClose(); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title={`Course feedback: ${b.batch.course}`} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={send.isPending} disabled={Object.values(ratings).some((v) => v === null)} onClick={() => send.mutate()}>Send feedback</Button>
    </>}>
      <div className="grid gap-4">
        {COURSE_FEEDBACK_AREAS.map((a) => (
          <div key={a} className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[14.5px] font-semibold">{COURSE_FEEDBACK_AREA_LABELS[a]}</span>
            <Scale label={COURSE_FEEDBACK_AREA_LABELS[a]} value={ratings[a]} onChange={(v) => setRatings((r) => ({ ...r, [a]: v }))} />
          </div>
        ))}
        <Textarea label="Anything else? (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} />
      </div>
    </Modal>
  );
}

// ── S8 Final project ──

export interface ProjectView {
  id: string; status: keyof typeof PROJECT_STATUS; updatedAt: string;
  student: { id: string; code: string; name: string }; batch: { id: string; name: string; course: string; branch: string };
  submissions: { id: string; version: number; title: string; description: string | null; link: string | null; createdAt: string; files: { id: string; name: string; sizeBytes: number; url: string }[] }[];
  reviews: { id: string; stage: 'TEACHER' | 'BRANCH'; decision: string; comment: string | null; createdAt: string; reviewer: string }[];
  canReview: boolean; canApprove: boolean;
}
const DECISION: Record<string, string> = { APPROVE: 'Approved', CHANGES: 'Changes requested', REJECT: 'Rejected', SEND_BACK: 'Sent back to the teacher' };

export function ProjectHistory({ p }: { p: ProjectView }) {
  const events = [
    ...p.submissions.map((s) => ({ at: s.createdAt, node: (
      <div className="rounded-lg border border-line p-3">
        <div className="text-[13px] text-muted">Version {s.version} submitted · {formatDate(s.createdAt)}</div>
        <div className="font-semibold">{s.title}</div>
        {s.description && <p className="whitespace-pre-wrap text-[14.5px]">{s.description}</p>}
        <div className="mt-1 flex flex-wrap gap-3 text-[14px]">
          {s.link && <a href={s.link} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><ExternalLink className="h-4 w-4" />Project link</a>}
          {s.files.map((f) => <a key={f.id} href={f.url} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"><Paperclip className="h-4 w-4" />{f.name}</a>)}
        </div>
      </div>
    ) })),
    ...p.reviews.map((r) => ({ at: r.createdAt, node: (
      <div className={clsx('rounded-lg p-3', r.decision === 'APPROVE' ? 'bg-ok-soft' : r.decision === 'REJECT' ? 'bg-bad-soft' : 'bg-warn-soft')}>
        <div className="text-[13px]"><b>{DECISION[r.decision]}</b> by {r.reviewer} ({r.stage === 'TEACHER' ? 'teacher' : 'branch'}) · {formatDate(r.createdAt)}</div>
        {r.comment && <p className="text-[14.5px]">{r.comment}</p>}
      </div>
    ) })),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return <div className="grid gap-2" aria-label="Project history">{events.map((e, i) => <div key={i}>{e.node}</div>)}</div>;
}

interface MyProject { enrolmentId: string; batch: { id: string; name: string; course: string; branch: string }; open: boolean; canSubmit: boolean; project: ProjectView | null }

export function StudentProjectsPage() {
  const q = useQuery({ queryKey: ['my-projects'], queryFn: () => get<MyProject[]>('/me/projects') });
  const [submitting, setSubmitting] = useState<MyProject | null>(null);
  return (
    <>
      <PageHeader title="Final project" subtitle="Submit your project, see your teacher's review and your branch's final approval." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title="No courses yet" icon={<FolderKanban className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-5">
          {q.data.map((m) => (
            <Card key={m.enrolmentId} title={<span>{m.batch.course} <span className="font-normal text-muted">· {m.batch.name}</span></span>} actions={<StatusBadge status={m.project?.status ?? 'NOT_SUBMITTED'} labels={PROJECT_STATUS} />}>
              {!m.open && !m.project && <p className="text-[14.5px] text-muted">Submissions open when the course hours are complete, or when your branch opens them.</p>}
              {m.project && <ProjectHistory p={m.project} />}
              {m.canSubmit && <Button className="mt-3" onClick={() => setSubmitting(m)}>{m.project?.status === 'CHANGES_REQUESTED' ? 'Submit a new version' : 'Submit your project'}</Button>}
            </Card>
          ))}
        </div>
      )}
      {submitting && <SubmitProject m={submitting} onClose={() => setSubmitting(null)} />}
    </>
  );
}

function SubmitProject({ m, onClose }: { m: MyProject; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const last = m.project?.submissions[0];
  const [title, setTitle] = useState(last?.title ?? '');
  const [description, setDescription] = useState(last?.description ?? '');
  const [link, setLink] = useState(last?.link ?? '');
  const [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const send = useMutation({
    mutationFn: () => post(`/me/projects/${m.enrolmentId}/submit`, { title, description, link, fileIds: files.map((f) => f.id) }),
    onSuccess: () => { toast('Project sent to your teacher'); void qc.invalidateQueries({ queryKey: ['my-projects'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); },
  });
  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        const fd = new FormData();
        fd.append('file', f);
        const r = await upload<{ id: string; name: string }>('/projects/upload', fd);
        setFiles((x) => [...x, r]);
      }
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setUploading(false); }
  };
  return (
    <Modal open onClose={onClose} title="Submit your project" size="lg" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={send.isPending} disabled={uploading} onClick={() => send.mutate()}>Send to teacher</Button>
    </>}>
      <div className="grid gap-4">
        <Input label="Project title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} required maxLength={200} />
        <Textarea label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={4} />
        <Input label="Link (GitHub or online demo)" type="url" placeholder="https://github.com/you/project" value={link} onChange={(e) => setLink(e.target.value)} error={errors.link} />
        <div>
          <label htmlFor="proj-files" className="mb-1 block text-[14px] font-semibold">Files</label>
          <input id="proj-files" type="file" multiple onChange={(e) => void pick(e.target.files)} className="block w-full text-[14px] file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold" />
          {uploading && <p className="mt-1 text-[13px] text-muted">Uploading…</p>}
          {files.map((f) => <p key={f.id} className="mt-1 inline-flex items-center gap-1 pr-3 text-[13px] text-ok"><Paperclip className="h-3.5 w-3.5" />{f.name}</p>)}
          <p className="mt-1 text-[12.5px] text-muted">Add a link, files (zip, PDF, documents), or both. Every version you send is kept.</p>
        </div>
      </div>
    </Modal>
  );
}
