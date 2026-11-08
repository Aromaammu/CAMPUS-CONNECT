import { useQuery, useQueryClient } from '@tanstack/react-query';
import { REQUEST_STATUS, courseRequestSchema, formatDateTime, formatINR, minutesToHours } from '@cc/shared';
import { Inbox, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Checkbox, Empty, ErrorBox, Input, Modal, Notice, PageHeader, Spinner, StatusBadge, Tabs, Textarea, useToast } from '@/components/ui';
import { BranchSelect } from '@/components/data';
import { ApiError, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ModulesEditor } from './CoursesPage';

interface RequestRow {
  id: string; branchId: string; name: string; category: string | null; totalMinutes: number; description: string | null; syllabus: { title: string; topics?: string }[]; feePaise: number;
  status: keyof typeof REQUEST_STATUS; decisionNote: string | null; createdAt: string; decidedAt: string | null; branch: { code: string; name: string }; course: { id: string; code: string } | null;
}

export function CourseRequestsPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'PENDING' | 'ALL'>('PENDING');
  const [edit, setEdit] = useState<RequestRow | 'new' | null>(null);
  const [deciding, setDeciding] = useState<RequestRow | null>(null);
  const q = useQuery({ queryKey: ['course-requests'], queryFn: () => get<RequestRow[]>('/course-requests') });
  const decider = can('courses.decide');
  const rows = (q.data ?? []).filter((r) => tab === 'ALL' || r.status === 'PENDING' || (!decider && r.status === 'SENT_BACK'));
  return (
    <>
      <PageHeader title="Course requests" subtitle={decider ? 'New courses proposed by branches' : 'Propose a new course to head office'}
        actions={can('courses.request') && !decider && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>New request</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'PENDING', label: decider ? 'Waiting for a decision' : 'Open', count: (q.data ?? []).filter((r) => r.status === 'PENDING' || (!decider && r.status === 'SENT_BACK')).length }, { id: 'ALL', label: 'All' }]} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !rows.length ? <Card><Empty title="No requests here" icon={<Inbox className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-3">
          {rows.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[13px] text-muted">{r.branch.code} · {formatDateTime(r.createdAt)}</p>
                  <h2 className="text-[17px] font-bold">{r.name}</h2>
                  <p className="text-[14px] text-muted">{[r.category, minutesToHours(r.totalMinutes), formatINR(r.feePaise), `${r.syllabus?.length ?? 0} modules`].filter(Boolean).join(' · ')}</p>
                  {r.description && <p className="mt-2 text-[14.5px]">{r.description}</p>}
                  {r.decisionNote && <div className="mt-3"><Notice tone={r.status === 'REJECTED' ? 'bad' : r.status === 'SENT_BACK' ? 'warn' : 'ok'} title="Head office note">{r.decisionNote}</Notice></div>}
                  {r.course && <p className="mt-2 text-[14px]">Added to the catalogue as <Link className="font-semibold text-brand underline" to={`/courses/${r.course.id}`}>{r.course.code}</Link></p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={r.status} labels={REQUEST_STATUS} />
                  {decider && r.status === 'PENDING' && <Button size="sm" onClick={() => setDeciding(r)}>Decide</Button>}
                  {!decider && r.status === 'SENT_BACK' && <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>Edit and resubmit</Button>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <RequestModal open={!!edit} onClose={() => setEdit(null)} request={edit === 'new' ? null : edit} />
      <DecideModal request={deciding} onClose={() => setDeciding(null)} />
    </>
  );
}

function RequestModal({ open, onClose, request }: { open: boolean; onClose: () => void; request: RequestRow | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [v, setV] = useState({ branchId: '', name: '', category: '', hours: '', description: '', fee: '' });
  const [modules, setModules] = useState<{ title: string; topics: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(request ? { branchId: request.branchId, name: request.name, category: request.category ?? '', hours: String(request.totalMinutes / 60), description: request.description ?? '', fee: String(request.feePaise / 100) } : { branchId: '', name: '', category: '', hours: '', description: '', fee: '' });
    setModules(request?.syllabus?.map((m) => ({ title: m.title, topics: m.topics ?? '' })) ?? [{ title: '', topics: '' }]);
  }, [open, request]);
  const save = async () => {
    const body = { ...v, syllabus: modules.filter((m) => m.title.trim()) };
    const parsed = courseRequestSchema.safeParse(body);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))); return; }
    setBusy(true);
    try {
      if (request) await put(`/course-requests/${request.id}`, body); else await post('/course-requests', body);
      toast(request ? 'Request resubmitted' : 'Request sent to head office');
      qc.invalidateQueries({ queryKey: ['course-requests'] });
      onClose();
    } catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const f = (k: keyof typeof v) => ({ value: v[k], onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value })), error: errors[k] });
  return (
    <Modal open={open} onClose={onClose} title={request ? 'Edit and resubmit' : 'Request a new course'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{request ? 'Resubmit' : 'Send request'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        {!request && <BranchSelect perm="courses.request" value={v.branchId} onChange={(b) => setV((s) => ({ ...s, branchId: b }))} error={errors.branchId} />}
        <Input label="Course name" required className={request ? 'sm:col-span-3' : 'sm:col-span-2'} {...f('name')} />
        <Input label="Category" {...f('category')} />
        <Input label="Total hours" type="number" required {...f('hours')} />
        <Input label="Suggested fee (₹)" type="number" {...f('fee')} />
        <Textarea label="Why do you need it?" className="sm:col-span-3" {...f('description')} />
      </div>
      <h3 className="mb-3 mt-6 text-[15px] font-bold">Proposed syllabus</h3>
      <ModulesEditor value={modules} onChange={setModules} />
    </Modal>
  );
}

function DecideModal({ request, onClose }: { request: RequestRow | null; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'SEND_BACK'>('APPROVE');
  const [note, setNote] = useState('');
  const [code, setCode] = useState('');
  const [shareAll, setShareAll] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (request) { setDecision('APPROVE'); setNote(''); setCode(''); setShareAll(false); setErrors({}); } }, [request]);
  const save = async () => {
    if (!request) return;
    setBusy(true);
    try {
      await post(`/course-requests/${request.id}/decision`, { decision, note, code, shareAll });
      toast(decision === 'APPROVE' ? 'Approved and added to the catalogue' : decision === 'REJECT' ? 'Request rejected' : 'Sent back to the branch');
      qc.invalidateQueries({ queryKey: ['course-requests'] }); qc.invalidateQueries({ queryKey: ['courses'] });
      onClose();
    } catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open={!!request} onClose={onClose} title={`Decide: ${request?.name ?? ''}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} variant={decision === 'REJECT' ? 'danger' : 'primary'} onClick={save}>{decision === 'APPROVE' ? 'Approve' : decision === 'REJECT' ? 'Reject' : 'Send back'}</Button></>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Decision">
          {([['APPROVE', 'Approve'], ['SEND_BACK', 'Send back'], ['REJECT', 'Reject']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={decision === k} onClick={() => setDecision(k)} className={`rounded-lg border px-3 py-2 text-[14px] font-semibold ${decision === k ? 'border-brand bg-brand-soft text-brand' : 'border-line hover:bg-surface-2'}`}>{l}</button>
          ))}
        </div>
        {decision === 'APPROVE' && <>
          <Input label="Course code" required value={code} onChange={(e) => setCode(e.target.value)} error={errors.code} help="The course joins the catalogue as Published." />
          <Checkbox label={`Open it to all branches (otherwise only ${request?.branch.code})`} checked={shareAll} onChange={(e) => setShareAll(e.target.checked)} />
        </>}
        <Textarea label={decision === 'APPROVE' ? 'Note to the branch (optional)' : 'Reason (the branch will see this)'} value={note} onChange={(e) => setNote(e.target.value)} error={errors.note} />
      </div>
    </Modal>
  );
}
