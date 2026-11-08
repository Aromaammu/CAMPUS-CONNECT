import { useQuery, useQueryClient } from '@tanstack/react-query';
import { COURSE_STATUS, courseSchema, formatINR, minutesToHours } from '@cc/shared';
import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Badge, Button, ButtonLink, Card, Checkbox, DefinitionList, Empty, ErrorBox, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Textarea, useConfirm, useToast,
} from '@/components/ui';
import { useBranchOptions, useDebounced } from '@/components/data';
import { ApiError, get, patch, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface CourseRow {
  id: string; code: string; name: string; category: string | null; totalMinutes: number; description: string | null; defaultFeePaise: number; feeLocked: boolean;
  status: keyof typeof COURSE_STATUS; allBranches: boolean; _count?: { modules: number; batches: number };
  branchAccess?: { branchId?: string; branch: { code: string; name?: string } }[]; modules?: { id: string; position: number; title: string; topics: string | null }[];
}

export function CoursesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const dq = useDebounced(q);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ['courses', dq, status], queryFn: () => get<CourseRow[]>('/courses', { q: dq, status }) });
  const manage = can('courses.manage');
  return (
    <>
      <PageHeader title="Courses" subtitle={manage ? 'The head-office course catalogue' : 'Courses your branch can run'}
        actions={<>
          {can('courses.request') && !manage && <ButtonLink to="/course-requests" variant="secondary">Request a new course</ButtonLink>}
          {manage && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add course</Button>}
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
        <SearchInput value={q} onChange={setQ} placeholder="Search courses" className="self-end" />
        {manage && <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(COURSE_STATUS).map(([value, label]) => ({ value, label }))} />}
      </div>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.length ? <Card><Empty title="No courses found" icon={<BookOpen className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => (
            <Link key={c.id} to={`/courses/${c.id}`} className="card flex flex-col gap-2 p-4 transition-colors hover:border-brand/50">
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-[12.5px] text-muted">{c.code}</span>
                {manage && <StatusBadge status={c.status} labels={COURSE_STATUS} />}
              </div>
              <h2 className="text-[17px] font-bold leading-snug">{c.name}</h2>
              <p className="text-[14px] text-muted">{[c.category, minutesToHours(c.totalMinutes), `${c._count?.modules ?? 0} modules`].filter(Boolean).join(' · ')}</p>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2 text-[13.5px]">
                <span className="font-semibold tabular">{formatINR(c.defaultFeePaise)}</span>
                <span className="text-muted">{c._count?.batches ?? 0} batches{!c.allBranches && ` · ${c.branchAccess?.map((b) => b.branch.code).join(', ') || 'no branches'}`}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
      <CourseModal open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

type ModuleDraft = { title: string; topics: string };
export function ModulesEditor({ value, onChange }: { value: ModuleDraft[]; onChange: (v: ModuleDraft[]) => void }) {
  const set = (i: number, patchV: Partial<ModuleDraft>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patchV } : m)));
  const move = (i: number, d: -1 | 1) => { const n = [...value]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return (
    <div className="grid gap-3">
      {value.map((m, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:items-start">
          <span className="pt-2 font-mono text-[13px] text-muted">{i + 1}.</span>
          <div className="grid gap-2">
            <input className="input" aria-label={`Module ${i + 1} title`} placeholder="Module title" value={m.title} onChange={(e) => set(i, { title: e.target.value })} />
            <textarea className="input" rows={2} aria-label={`Module ${i + 1} topics`} placeholder="Topics (optional)" value={m.topics} onChange={(e) => set(i, { topics: e.target.value })} />
          </div>
          <div className="flex gap-1 sm:flex-col">
            <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" aria-label="Remove module" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onChange([...value, { title: '', topics: '' }])} className="justify-self-start">Add module</Button>
    </div>
  );
}

function CourseModal({ open, onClose, course }: { open: boolean; onClose: () => void; course?: CourseRow | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const branches = useBranchOptions('branch.view');
  const [v, setV] = useState({ code: '', name: '', category: '', hours: '', description: '', defaultFee: '', feeLocked: false, allBranches: true, branchIds: [] as string[] });
  const [modules, setModules] = useState<ModuleDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(course ? {
      code: course.code, name: course.name, category: course.category ?? '', hours: String(course.totalMinutes / 60), description: course.description ?? '', defaultFee: String(course.defaultFeePaise / 100),
      feeLocked: course.feeLocked, allBranches: course.allBranches, branchIds: course.branchAccess?.map((b) => b.branchId!).filter(Boolean) ?? [],
    } : { code: '', name: '', category: '', hours: '', description: '', defaultFee: '', feeLocked: false, allBranches: true, branchIds: [] });
    setModules(course?.modules?.map((m) => ({ title: m.title, topics: m.topics ?? '' })) ?? [{ title: '', topics: '' }]);
  }, [open, course]);
  const save = async () => {
    const body = { ...v, modules: modules.filter((m) => m.title.trim()) };
    const parsed = courseSchema.safeParse(body);
    if (!parsed.success) { setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message]))); return; }
    setBusy(true);
    try {
      const r = course ? await put<CourseRow>(`/courses/${course.id}`, body) : await post<CourseRow>('/courses', body);
      toast(course ? 'Course saved' : 'Course added as a draft. Publish it when ready.');
      qc.invalidateQueries({ queryKey: ['courses'] }); qc.invalidateQueries({ queryKey: ['course'] });
      onClose();
      if (!course) nav(`/courses/${r.id}`);
    } catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const f = (k: keyof typeof v) => ({ value: String(v[k]), onChange: (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value })), error: errors[k] });
  return (
    <Modal open={open} onClose={onClose} title={course ? `Edit ${course.name}` : 'Add a course'} size="xl"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{course ? 'Save course' : 'Add course'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Code" required {...f('code')} help="e.g. PY-FS" />
        <Input label="Course name" required className="sm:col-span-2" {...f('name')} />
        <Input label="Category" {...f('category')} />
        <Input label="Total hours" type="number" required {...f('hours')} />
        <Input label="Default fee (₹)" type="number" {...f('defaultFee')} />
        <Textarea label="Description" className="sm:col-span-3" {...f('description')} />
        <Checkbox className="sm:col-span-3" label="Lock the fee: branches cannot set their own price" checked={v.feeLocked} onChange={(e) => setV((s) => ({ ...s, feeLocked: e.target.checked }))} />
        <Checkbox className="sm:col-span-3" label="Open to all branches" checked={v.allBranches} onChange={(e) => setV((s) => ({ ...s, allBranches: e.target.checked }))} />
        {!v.allBranches && (
          <div className="grid gap-2 sm:col-span-3 sm:grid-cols-3">
            {(branches.data ?? []).map((b) => (
              <Checkbox key={b.id} label={`${b.code} · ${b.name}`} checked={v.branchIds.includes(b.id)} onChange={(e) => setV((s) => ({ ...s, branchIds: e.target.checked ? [...s.branchIds, b.id] : s.branchIds.filter((x) => x !== b.id) }))} />
            ))}
          </div>
        )}
      </div>
      <h3 className="mb-3 mt-6 text-[15px] font-bold">Syllabus</h3>
      <ModulesEditor value={modules} onChange={setModules} />
    </Modal>
  );
}

export function CourseDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['course', id], queryFn: () => get<CourseRow>(`/courses/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const c = q.data;
  const manage = can('courses.manage');
  const setStatus = async (status: 'PUBLISHED' | 'RETIRED' | 'DRAFT') => {
    const label = status === 'PUBLISHED' ? 'Publish' : status === 'RETIRED' ? 'Retire' : 'Move to draft';
    if (!(await confirm({ title: `${label} ${c.name}?`, body: status === 'PUBLISHED' ? 'Branches it is open to can create batches.' : status === 'RETIRED' ? 'No new batches can be created. Running batches continue.' : undefined, confirmLabel: label, danger: status === 'RETIRED' })).ok) return;
    await patch(`/courses/${id}/status`, { status });
    toast(`Course ${status === 'PUBLISHED' ? 'published' : status === 'RETIRED' ? 'retired' : 'moved to draft'}`);
    qc.invalidateQueries({ queryKey: ['course', id] }); qc.invalidateQueries({ queryKey: ['courses'] });
  };
  return (
    <>
      <PageHeader back={{ to: '/courses', label: 'Courses' }}
        title={<span className="flex flex-wrap items-center gap-3">{c.name}{manage && <StatusBadge status={c.status} labels={COURSE_STATUS} />}</span>}
        subtitle={<span className="font-mono">{c.code}</span>}
        actions={<>
          {can('batches.manage') && c.status === 'PUBLISHED' && <ButtonLink to={`/batches/new?courseId=${c.id}`} variant="primary">Create a batch</ButtonLink>}
          {manage && <Button variant="secondary" onClick={() => setEditing(true)}>Edit course</Button>}
          {manage && c.status !== 'PUBLISHED' && <Button variant="accent" onClick={() => setStatus('PUBLISHED')}>Publish</Button>}
          {manage && c.status === 'PUBLISHED' && <Button variant="ghost" onClick={() => setStatus('RETIRED')}>Retire</Button>}
        </>} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Card title="About">
          <DefinitionList items={[
            ['Category', c.category], ['Duration', minutesToHours(c.totalMinutes)], ['Default fee', <span key="f" className="tabular">{formatINR(c.defaultFeePaise)}{c.feeLocked && <Badge className="ml-2" tone="warn" dot={false}>Locked</Badge>}</span>],
            ['Branches', c.allBranches ? 'All branches' : c.branchAccess?.map((b) => b.branch.code).join(', ') || 'None yet'],
          ]} />
          {c.description && <p className="mt-4 text-[14.5px] text-muted">{c.description}</p>}
        </Card>
        <Card title="Syllabus" padded={false}>
          {!c.modules?.length ? <Empty title="No modules yet" /> : (
            <ol className="divide-y divide-line">
              {c.modules.map((m) => (
                <li key={m.id} className="flex gap-3 px-4 py-3">
                  <span className="font-mono text-[13px] text-muted">{m.position}.</span>
                  <span><b>{m.title}</b>{m.topics && <span className="block text-[14px] text-muted">{m.topics}</span>}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
      <CourseModal open={editing} onClose={() => setEditing(false)} course={c} />
    </>
  );
}
