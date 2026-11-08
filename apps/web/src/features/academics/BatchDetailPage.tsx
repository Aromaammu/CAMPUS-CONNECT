import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BATCH_MODES, BATCH_STATUS, ENROLMENT_STATUS, SESSION_STATUS, formatDate, formatDays, formatHHMM, formatINR, formatTime, formatWeekdayDate, minutesToHours,
} from '@cc/shared';
import { MoreHorizontal, UserPlus } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Avatar, Badge, Button, Card, Checkbox, DefinitionList, Empty, ErrorBox, Input, Modal, PageHeader, SearchInput, Select, Spinner, StatusBadge, Tabs, Textarea, useConfirm, useToast, clsx,
} from '@/components/ui';
import { Paged, useDebounced } from '@/components/data';
import { ApiError, get, post, put } from '@/lib/api';
import { BATCH_TABS, SESSION_ACTIONS } from './batchTabs';
import { BatchDetail, BatchRow, EnrolmentRow, SessionRow, backupTeacher, mainTeacher } from './types';

export function HoursBar({ delivered, scheduled, total }: { delivered: number; scheduled: number; total: number }) {
  const pct = Math.min(100, Math.round((delivered / Math.max(total, 1)) * 100));
  return (
    <div>
      <div className="flex justify-between text-[13px] text-muted"><span><b className="text-fg tabular">{minutesToHours(delivered)}</b> of {minutesToHours(total)} delivered</span><span className="tabular">{pct}%</span></div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Hours delivered">
        <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
      </div>
      {scheduled < total && <p className="mt-1 text-[12.5px] text-warn">Only {minutesToHours(scheduled)} is scheduled. Add sessions to cover the course.</p>}
    </div>
  );
}

export function BatchDetailPage({ backTo = '/batches', backLabel = 'Batches' }: { backTo?: string; backLabel?: string }) {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [tab, setTab] = useState('sessions');
  const [editing, setEditing] = useState(false);
  const q = useQuery({ queryKey: ['batch', id], queryFn: () => get<BatchDetail>(`/batches/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const b = q.data;
  const student = b.viewerRole === 'student';
  const tabs = [
    { id: 'sessions', label: 'Classes' },
    ...(!student ? [{ id: 'students', label: 'Students', count: b._count.enrolments }] : []),
    ...BATCH_TABS.filter((t) => t.show(b)).map((t) => ({ id: t.id, label: t.label })),
  ];
  const extra = BATCH_TABS.find((t) => t.id === tab);
  return (
    <>
      <PageHeader back={{ to: backTo, label: backLabel }}
        title={<span className="flex flex-wrap items-center gap-3">{b.name}<Badge tone="brand" dot={false}>{BATCH_MODES[b.mode]}</Badge><StatusBadge status={b.status} labels={BATCH_STATUS} /></span>}
        subtitle={<>{b.course.name} · {b.branch.code}</>}
        actions={b.canManage && <Button variant="secondary" onClick={() => setEditing(true)}>Batch settings</Button>} />
      <div className="mb-5 grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card>
          <DefinitionList items={[
            ['When', `${formatDays(b.days)} · ${formatHHMM(b.startTime)}–${formatHHMM(b.endTime)}`],
            ['Started', formatDate(b.startDate)],
            ['Teacher', <span key="t">{mainTeacher(b)?.user.name ?? '—'}{backupTeacher(b) && <span className="text-muted"> · backup {backupTeacher(b)!.user.name}</span>}</span>],
            ...(b.room ? [['Room', b.room.name] as [ReactNode, ReactNode]] : []),
            ...(!student ? [['Seats', `${b._count.enrolments} of ${b.capacity} filled`] as [ReactNode, ReactNode], ['Fee', formatINR(b.feePaise ?? b.course.defaultFeePaise)] as [ReactNode, ReactNode]] : []),
          ]} />
        </Card>
        <Card><HoursBar delivered={b.hours.deliveredMinutes} scheduled={b.hours.scheduledMinutes} total={b.course.totalMinutes} /></Card>
      </div>
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'sessions' && <SessionsTab batch={b} />}
      {tab === 'students' && !student && <StudentsTab batch={b} />}
      {extra && extra.render(b)}
      {b.canManage && <BatchSettingsModal open={editing} onClose={() => setEditing(false)} batch={b} onSaved={() => qc.invalidateQueries({ queryKey: ['batch', id] })} />}
    </>
  );
}

function SessionsTab({ batch }: { batch: BatchDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['batch-sessions', batch.id], queryFn: () => get<SessionRow[]>(`/batches/${batch.id}/sessions`) });
  const [act, setAct] = useState<{ kind: 'move' | 'cancel' | 'sub'; s: SessionRow } | null>(null);
  const [menu, setMenu] = useState<SessionRow | null>(null);
  const [showPast, setShowPast] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ['batch-sessions', batch.id] }); qc.invalidateQueries({ queryKey: ['batch', batch.id] }); qc.invalidateQueries({ queryKey: ['timetable'] }); };
  const extend = async () => { const r = await post<{ added: number }>(`/batches/${batch.id}/extend`, { count: 1 }); toast(`${r.added} class added at the end`); refresh(); };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const now = Date.now();
  const all = q.data ?? [];
  const past = all.filter((s) => new Date(s.endsAt).getTime() < now);
  const rows = showPast ? all : all.filter((s) => new Date(s.endsAt).getTime() >= now);
  return (
    <Card padded={false} title={<span className="text-[15px] font-bold">{all.filter((s) => s.status !== 'CANCELLED').length} classes</span>}
      actions={<>
        {past.length > 0 && <Button size="sm" variant="ghost" onClick={() => setShowPast((s) => !s)}>{showPast ? 'Hide past classes' : `Show ${past.length} past classes`}</Button>}
        {batch.canManage && <Button size="sm" variant="secondary" onClick={extend}>Add a class at the end</Button>}
      </>}>
      {!rows.length ? <Empty title="No upcoming classes" /> : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li key={s.id} className={clsx('flex flex-wrap items-center gap-3 px-4 py-3', s.status === 'CANCELLED' && 'opacity-60')}>
              <span className="w-10 shrink-0 font-mono text-[13px] text-muted">#{s.position}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block font-semibold', s.status === 'CANCELLED' && 'line-through')}>{formatWeekdayDate(s.startsAt)} · {formatTime(s.startsAt)}–{formatTime(s.endsAt)}</span>
                <span className="block text-[13px] text-muted">
                  {s.teacher ? <span className="font-semibold text-accent">Substitute: {s.teacher.user.name}</span> : mainTeacher(batch)?.user.name}
                  {s.room && ` · ${s.room.name}`}{s.cancelReason && ` · ${s.cancelReason}`}{s.topic && ` · ${s.topic}`}
                </span>
              </span>
              {SESSION_ACTIONS.map((A, i) => <A key={i} batch={batch} session={s} />)}
              <StatusBadge status={s.status} labels={SESSION_STATUS} />
              {batch.canManage && s.status === 'SCHEDULED' && new Date(s.startsAt).getTime() > now && (
                <Button size="sm" variant="ghost" aria-label={`Change class ${s.position}`} onClick={() => setMenu(s)}><MoreHorizontal className="h-4 w-4" /></Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!menu} onClose={() => setMenu(null)} title={menu ? `Class ${menu.position}: ${formatWeekdayDate(menu.startsAt)}` : ''} size="sm">
        {menu && <div className="grid gap-2">
          <Button variant="secondary" onClick={() => { setAct({ kind: 'move', s: menu }); setMenu(null); }}>Reschedule</Button>
          <Button variant="secondary" onClick={() => { setAct({ kind: 'sub', s: menu }); setMenu(null); }}>Substitute teacher</Button>
          <Button variant="danger" onClick={() => { setAct({ kind: 'cancel', s: menu }); setMenu(null); }}>Cancel this class</Button>
        </div>}
      </Modal>
      <SessionChangeModal batch={batch} action={act} onClose={() => setAct(null)} onDone={refresh} />
    </Card>
  );
}


function SessionChangeModal({ batch, action, onClose, onDone }: { batch: BatchDetail; action: { kind: 'move' | 'cancel' | 'sub'; s: SessionRow } | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('');
  const [makeUp, setMakeUp] = useState(true);
  const [teacherId, setTeacherId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const teachers = useQuery({ queryKey: ['teachers', batch.branchId], queryFn: () => get<{ id: string; name: string }[]>('/employees/options', { branchId: batch.branchId, perm: 'sessions.teach' }), enabled: action?.kind === 'sub' });
  useEffect(() => {
    if (!action) return;
    setErrors({}); setReason(''); setMakeUp(true); setTeacherId(action.s.teacherId ?? '');
    setDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(action.s.startsAt)));
    setStart(batch.startTime); setEnd(batch.endTime);
  }, [action, batch]);
  if (!action) return null;
  const go = async () => {
    setBusy(true); setErrors({});
    try {
      let clashes: { kind: string; with: string }[] = [];
      if (action.kind === 'move') clashes = (await post<{ clashes: typeof clashes }>(`/batches/sessions/${action.s.id}/reschedule`, { date, startTime: start, endTime: end })).clashes;
      if (action.kind === 'cancel') await post(`/batches/sessions/${action.s.id}/cancel`, { reason, addMakeUp: makeUp });
      if (action.kind === 'sub') clashes = (await post<{ clashes: typeof clashes }>(`/batches/sessions/${action.s.id}/substitute`, { teacherId })).clashes;
      toast(action.kind === 'move' ? 'Class moved. Students have been told.' : action.kind === 'cancel' ? 'Class cancelled. Students have been told.' : 'Teacher changed. Students have been told.');
      if (clashes?.length) toast(`Heads up: ${clashes[0].kind === 'room' ? 'the room' : 'the teacher'} is also booked with ${clashes[0].with}`, 'info');
      onDone(); onClose();
    } catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const title = action.kind === 'move' ? 'Reschedule class' : action.kind === 'cancel' ? 'Cancel class' : 'Substitute teacher';
  return (
    <Modal open onClose={onClose} title={`${title} ${action.s.position}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Back</Button><Button loading={busy} variant={action.kind === 'cancel' ? 'danger' : 'primary'} onClick={go} disabled={action.kind === 'cancel' && reason.trim().length < 3}>{action.kind === 'cancel' ? 'Cancel class' : 'Save'}</Button></>}>
      <div className="grid gap-4">
        <p className="text-[14px] text-muted">Currently {formatWeekdayDate(action.s.startsAt)}, {formatTime(action.s.startsAt)}–{formatTime(action.s.endsAt)}. Students get an in-app notice, email and SMS.</p>
        {action.kind === 'move' && <>
          <Input label="New date" type="date" value={date} onChange={(e) => setDate(e.target.value)} error={errors.date} />
          <div className="grid grid-cols-2 gap-3"><Input label="Starts" type="time" value={start} onChange={(e) => setStart(e.target.value)} /><Input label="Ends" type="time" value={end} onChange={(e) => setEnd(e.target.value)} error={errors.endTime} /></div>
        </>}
        {action.kind === 'cancel' && <>
          <Textarea label="Reason (students will see this)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Checkbox label="Add a make-up class at the end of the batch" checked={makeUp} onChange={(e) => setMakeUp(e.target.checked)} />
        </>}
        {action.kind === 'sub' && <Select label="Who takes this class?" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} placeholder={`The regular teacher (${mainTeacher(batch)?.user.name ?? ''})`}
          options={(teachers.data ?? []).filter((t) => t.id !== mainTeacher(batch)?.id).map((t) => ({ value: t.id, label: t.name }))} />}
      </div>
    </Modal>
  );
}

function StudentsTab({ batch }: { batch: BatchDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<EnrolmentRow | null>(null);
  const q = useQuery({ queryKey: ['enrolments', batch.id], queryFn: () => get<EnrolmentRow[]>(`/batches/${batch.id}/enrolments`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['enrolments', batch.id] }); qc.invalidateQueries({ queryKey: ['batch', batch.id] }); };
  const act = async (e: EnrolmentRow, action: 'HOLD' | 'RESUME' | 'DROP') => {
    const label = { HOLD: 'Put on hold', RESUME: 'Resume', DROP: 'Drop' }[action];
    const r = await confirm({ title: `${label}: ${e.student.user.name}?`, confirmLabel: label, danger: action === 'DROP', requireReason: action === 'DROP', reasonLabel: 'Why is the student leaving?' });
    if (!r.ok) return;
    try { await post(`/batches/enrolments/${e.id}/action`, { action, note: r.reason }); toast('Saved'); refresh(); } catch (err) { toast((err as Error).message, 'bad'); }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data ?? [];
  return (
    <Card padded={false} title={<span className="text-[15px] font-bold">{batch._count.enrolments} of {batch.capacity} seats filled</span>}
      actions={batch.canEnrol && <Button size="sm" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAdding(true)}>Enrol students</Button>}>
      {!rows.length ? <Empty title="No students yet" /> : (
        <ul className="divide-y divide-line">
          {rows.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Avatar name={e.student.user.name} size={32} />
              <span className="min-w-0 flex-1">
                <Link to={`/students/${e.student.id}`} className="block font-semibold hover:underline">{e.student.user.name}</Link>
                <span className="block font-mono text-[12.5px] text-muted">{e.student.code}{e.student.branchId !== batch.branchId && ` · home branch ${e.student.branch.code}`}</span>
                {e.statusNote && <span className="block text-[12.5px] text-muted">{e.statusNote}</span>}
              </span>
              <StatusBadge status={e.status} labels={ENROLMENT_STATUS} />
              {batch.canEnrol && (e.status === 'ACTIVE' || e.status === 'ON_HOLD') && (
                <span className="flex flex-wrap gap-1">
                  {e.status === 'ACTIVE' ? <Button size="sm" variant="ghost" onClick={() => act(e, 'HOLD')}>Hold</Button> : <Button size="sm" variant="ghost" onClick={() => act(e, 'RESUME')}>Resume</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setMoving(e)}>Move</Button>
                  <Button size="sm" variant="ghost" onClick={() => act(e, 'DROP')}>Drop</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <EnrolModal open={adding} onClose={() => setAdding(false)} batch={batch} enrolled={rows} onDone={refresh} />
      <MoveModal enrolment={moving} batch={batch} onClose={() => setMoving(null)} onDone={refresh} />
    </Card>
  );
}

interface StudentPick { id: string; code: string; user: { name: string; mobile: string | null }; branch: { code: string } }
function EnrolModal({ open, onClose, batch, enrolled, onDone }: { open: boolean; onClose: () => void; batch: BatchDetail; enrolled: EnrolmentRow[]; onDone: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setPicked(new Set()); setQ(''); } }, [open]);
  const list = useQuery({ queryKey: ['students-pick', batch.branchId, dq], queryFn: () => get<Paged<StudentPick>>('/students', { branchId: dq ? '' : batch.branchId, q: dq, status: 'ACTIVE', pageSize: 50 }), enabled: open, placeholderData: keepPreviousData });
  const already = new Set(enrolled.filter((e) => e.status === 'ACTIVE' || e.status === 'ON_HOLD').map((e) => e.studentId));
  const left = batch.capacity - batch._count.enrolments;
  const save = async () => {
    setBusy(true);
    try { const r = await post<{ enrolled: number }>(`/batches/${batch.id}/enrolments`, { studentIds: [...picked] }); toast(`${r.enrolled} student(s) enrolled`); onDone(); onClose(); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`Enrol students in ${batch.name}`} size="lg"
      footer={<><span className="mr-auto self-center text-[13.5px] text-muted">{picked.size} chosen · {left} seat(s) left</span><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!picked.size || picked.size > left} onClick={save}>Enrol {picked.size || ''}</Button></>}>
      <SearchInput value={q} onChange={setQ} placeholder="Search any branch by name, ID or mobile" className="mb-3" />
      <p className="help mb-3">Students from other branches can join this batch too.</p>
      {list.isLoading ? <Spinner /> : (
        <ul className="max-h-[50vh] divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {(list.data?.rows ?? []).map((s) => {
            const done = already.has(s.id);
            return (
              <li key={s.id} className="px-3 py-2">
                <Checkbox disabled={done} checked={done || picked.has(s.id)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.id); else n.delete(s.id); return n; })}
                  label={<span>{s.user.name} <span className="font-mono text-[12.5px] text-muted">{s.code}</span>{s.branch.code !== batch.branch.code && <Badge className="ml-2" dot={false}>{s.branch.code}</Badge>}{done && <span className="ml-2 text-[12.5px] text-muted">already in this batch</span>}</span>} />
              </li>
            );
          })}
          {!list.data?.rows.length && <li className="px-3 py-6 text-center text-muted">No students found</li>}
        </ul>
      )}
    </Modal>
  );
}

function MoveModal({ enrolment, batch, onClose, onDone }: { enrolment: EnrolmentRow | null; batch: BatchDetail; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const options = useQuery({ queryKey: ['batches', 'same-course', batch.courseId], queryFn: () => get<BatchRow[]>('/batches', { courseId: batch.courseId }), enabled: !!enrolment });
  useEffect(() => { setTo(''); setNote(''); }, [enrolment]);
  const save = async () => {
    try { await post(`/batches/enrolments/${enrolment!.id}/action`, { action: 'MOVE', toBatchId: to, note }); toast('Student moved'); onDone(); onClose(); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <Modal open={!!enrolment} onClose={onClose} title={`Move ${enrolment?.student.user.name ?? ''}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!to} onClick={save}>Move student</Button></>}>
      <div className="grid gap-4">
        <Select label="New batch (same course)" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Choose a batch"
          options={(options.data ?? []).filter((x) => x.id !== batch.id && x.status !== 'CANCELLED' && x.status !== 'COMPLETED').map((x) => ({ value: x.id, label: `${x.branch.code} · ${x.name} (${x._count.enrolments}/${x.capacity})` }))} />
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <p className="help">Attendance and history stay with the old batch.</p>
      </div>
    </Modal>
  );
}

function BatchSettingsModal({ open, onClose, batch, onSaved }: { open: boolean; onClose: () => void; batch: BatchDetail; onSaved: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const teachers = useQuery({ queryKey: ['teachers', batch.branchId], queryFn: () => get<{ id: string; name: string }[]>('/employees/options', { branchId: batch.branchId, perm: 'sessions.teach' }), enabled: open });
  const rooms = useQuery({ queryKey: ['branch', batch.branchId], queryFn: () => get<{ rooms: { id: string; name: string; active: boolean }[] }>(`/branches/${batch.branchId}`), enabled: open && batch.mode !== 'ONLINE' });
  const [v, setV] = useState({ name: '', capacity: '', roomId: '', teacherId: '', backupTeacherId: '', autoRecord: true, checkinRequired: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) setV({ name: batch.name, capacity: String(batch.capacity), roomId: batch.roomId ?? '', teacherId: mainTeacher(batch)?.id ?? '', backupTeacherId: backupTeacher(batch)?.id ?? '', autoRecord: batch.autoRecord, checkinRequired: batch.checkinRequired });
  }, [open, batch]);
  const save = async () => {
    try { await put(`/batches/${batch.id}`, v); toast('Batch saved'); onSaved(); onClose(); }
    catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); }
  };
  const cancelBatch = async () => {
    const r = await confirm({ title: `Cancel ${batch.name}?`, body: 'All future classes are cancelled. Past classes and attendance are kept.', confirmLabel: 'Cancel batch', danger: true, requireReason: true });
    if (!r.ok) return;
    await post(`/batches/${batch.id}/cancel`, { reason: r.reason });
    toast('Batch cancelled'); onSaved(); onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Batch settings" size="lg"
      footer={<><Button variant="danger" className="mr-auto" onClick={cancelBatch} disabled={batch.status === 'CANCELLED'}>Cancel batch</Button><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Batch name" value={v.name} onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))} error={errors.name} />
        <Input label="Seats" type="number" value={v.capacity} onChange={(e) => setV((s) => ({ ...s, capacity: e.target.value }))} error={errors.capacity} />
        <Select label="Main teacher" value={v.teacherId} onChange={(e) => setV((s) => ({ ...s, teacherId: e.target.value }))} options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.name }))} error={errors.teacherId} />
        <Select label="Backup teacher" value={v.backupTeacherId} onChange={(e) => setV((s) => ({ ...s, backupTeacherId: e.target.value }))} placeholder="None" options={(teachers.data ?? []).filter((t) => t.id !== v.teacherId).map((t) => ({ value: t.id, label: t.name }))} />
        {batch.mode !== 'ONLINE' && <Select label="Room" value={v.roomId} onChange={(e) => setV((s) => ({ ...s, roomId: e.target.value }))} options={(rooms.data?.rooms ?? []).filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))} error={errors.roomId} />}
        {batch.mode !== 'OFFLINE' && <Checkbox className="sm:col-span-2" label="Record every online class automatically" checked={v.autoRecord} onChange={(e) => setV((s) => ({ ...s, autoRecord: e.target.checked }))} />}
        {batch.mode !== 'OFFLINE' && <Checkbox className="sm:col-span-2" label="Students must also tap 'I'm present' during check-ins" checked={v.checkinRequired} onChange={(e) => setV((s) => ({ ...s, checkinRequired: e.target.checked }))} />}
      </div>
      <p className="help mt-4">To change days or times, reschedule individual classes from the Classes tab.</p>
    </Modal>
  );
}
