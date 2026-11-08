import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, WEEKDAYS, batchSchema, formatDate, formatDateTime, formatINR } from '@cc/shared';
import { AlertTriangle, CalendarCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Card, Checkbox, Input, Notice, PageHeader, Select, Spinner, clsx, useToast } from '@/components/ui';
import { BranchSelect, useDebounced } from '@/components/data';
import { ApiError, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CourseRow } from './CoursesPage';

interface Preview { sessions: number; first: string | null; last: string | null; clashCount: number; clashes: { kind: 'teacher' | 'room'; startsAt: string; with: string }[] }
interface Option { id: string; name: string; code?: string; designation?: string }
interface Room { id: string; name: string; capacity: number; active: boolean }

export function BatchFormPage() {
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [params] = useSearchParams();
  const [v, setV] = useState({
    branchId: '', courseId: params.get('courseId') ?? '', name: '', mode: 'ONLINE', startDate: '', days: [1, 2, 3, 4, 5] as number[], startTime: '09:00', endTime: '11:00',
    roomId: '', capacity: '30', teacherId: '', backupTeacherId: '', autoRecord: true, checkinRequired: false, fee: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const courses = useQuery({ queryKey: ['courses', 'branch', v.branchId], queryFn: () => get<CourseRow[]>('/courses', { branchId: v.branchId }), enabled: !!v.branchId });
  const teachers = useQuery({ queryKey: ['teachers', v.branchId], queryFn: () => get<Option[]>('/employees/options', { branchId: v.branchId, perm: 'sessions.teach' }), enabled: !!v.branchId });
  const branch = useQuery({ queryKey: ['branch', v.branchId], queryFn: () => get<{ rooms: Room[] }>(`/branches/${v.branchId}`), enabled: !!v.branchId });
  const course = courses.data?.find((c) => c.id === v.courseId);
  const set = (k: keyof typeof v, val: unknown) => setV((s) => ({ ...s, [k]: val }));

  const body = useMemo(() => ({ ...v, fee: v.fee === '' ? undefined : v.fee, roomId: v.mode === 'ONLINE' ? '' : v.roomId }), [v]);
  const debounced = useDebounced(body, 400);
  const parsed = batchSchema.safeParse(debounced);
  const preview = useQuery({ queryKey: ['batch-preview', debounced], queryFn: () => post<Preview>('/batches/preview', debounced), enabled: parsed.success, retry: false });

  useEffect(() => { if (course && !v.fee && !course.feeLocked) set('fee', String(course.defaultFeePaise / 100)); }, [course]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const p = batchSchema.safeParse(body);
    if (!p.success) { setErrors(Object.fromEntries(p.error.issues.map((i) => [i.path.join('.'), i.message]))); toast('Please check the form', 'bad'); return; }
    setBusy(true); setErrors({});
    try {
      const b = await post<{ id: string }>('/batches', body);
      toast('Batch created with its timetable');
      nav(`/batches/${b.id}`);
    } catch (e) { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); setBusy(false); }
  };

  const rooms = (branch.data?.rooms ?? []).filter((r) => r.active);
  return (
    <>
      <PageHeader back={{ to: '/batches', label: 'Batches' }} title="New batch" subtitle="Sessions are created automatically, skipping holidays, until the course hours are covered" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <BranchSelect perm="batches.manage" value={v.branchId} onChange={(b) => setV((s) => ({ ...s, branchId: b, teacherId: '', backupTeacherId: '', roomId: '' }))} error={errors.branchId} />
            <Select label="Course" required value={v.courseId} onChange={(e) => set('courseId', e.target.value)} placeholder={v.branchId ? 'Choose a course' : 'Choose a branch first'} disabled={!v.branchId}
              options={(courses.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.totalMinutes / 60} h)` }))} error={errors.courseId} />
            <Input label="Batch name" required value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Morning Batch A" error={errors.name} />
            <Select label="Class type" value={v.mode} onChange={(e) => set('mode', e.target.value)} options={Object.entries(BATCH_MODES).map(([value, label]) => ({ value, label }))} />
            <Input label="Start date" type="date" required value={v.startDate} onChange={(e) => set('startDate', e.target.value)} error={errors.startDate} />
            <Input label="Seats" type="number" min={1} required value={v.capacity} onChange={(e) => set('capacity', e.target.value)} error={errors.capacity} />
            <fieldset className="sm:col-span-2">
              <legend className="label">Class days <span className="text-bad">*</span></legend>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((d, i) => {
                  const on = v.days.includes(i);
                  return <button key={d} type="button" aria-pressed={on} onClick={() => set('days', on ? v.days.filter((x) => x !== i) : [...v.days, i].sort())}
                    className={clsx('min-w-[52px] rounded-lg border px-3 py-2 text-[14px] font-semibold', on ? 'border-brand bg-brand text-brand-fg' : 'border-line hover:bg-surface-2')}>{d}</button>;
                })}
              </div>
              {errors.days && <p className="err">{errors.days}</p>}
            </fieldset>
            <Input label="Starts at" type="time" required value={v.startTime} onChange={(e) => set('startTime', e.target.value)} error={errors.startTime} />
            <Input label="Ends at" type="time" required value={v.endTime} onChange={(e) => set('endTime', e.target.value)} error={errors.endTime} />
            <Select label="Main teacher" required value={v.teacherId} onChange={(e) => set('teacherId', e.target.value)} placeholder="Choose a teacher" disabled={!v.branchId}
              options={(teachers.data ?? []).map((t) => ({ value: t.id, label: `${t.name} · ${t.designation}` }))} error={errors.teacherId} />
            <Select label="Backup teacher" value={v.backupTeacherId} onChange={(e) => set('backupTeacherId', e.target.value)} placeholder="None" disabled={!v.branchId}
              options={(teachers.data ?? []).filter((t) => t.id !== v.teacherId).map((t) => ({ value: t.id, label: t.name }))} />
            {v.mode !== 'ONLINE' && (
              <Select label="Room" required value={v.roomId} onChange={(e) => set('roomId', e.target.value)} placeholder="Choose a room" options={rooms.map((r) => ({ value: r.id, label: `${r.name} (${r.capacity} seats)` }))} error={errors.roomId} />
            )}
            {course && !course.feeLocked && can('fees.manage', v.branchId) ? (
              <Input label="Batch fee (₹)" type="number" value={v.fee} onChange={(e) => set('fee', e.target.value)} help={`Head-office price ${formatINR(course.defaultFeePaise)}`} />
            ) : course ? <p className="self-end text-[14px] text-muted">Fee: <b className="text-fg">{formatINR(course.defaultFeePaise)}</b>{course.feeLocked ? ' (set by head office)' : ''}</p> : null}
            {v.mode !== 'OFFLINE' && <Checkbox className="sm:col-span-2" label="Record every online class automatically" checked={v.autoRecord} onChange={(e) => set('autoRecord', e.target.checked)} />}
            {v.mode !== 'OFFLINE' && <Checkbox className="sm:col-span-2" label="Students must also tap 'I'm present' during check-ins to be marked Present" checked={v.checkinRequired} onChange={(e) => set('checkinRequired', e.target.checked)} />}
          </div>
          <div className="mt-6 flex flex-wrap gap-2"><Button onClick={save} loading={busy}>Create batch</Button><Button variant="secondary" onClick={() => nav('/batches')}>Cancel</Button></div>
        </Card>
        <div className="lg:sticky lg:top-20 lg:self-start">
          <Card title="Timetable preview">
            {!parsed.success ? <p className="text-[14.5px] text-muted">Fill in the course, dates, days, times and teacher to see the timetable.</p>
              : preview.isLoading ? <Spinner label="Working it out" />
              : preview.error ? <Notice tone="bad">{(preview.error as Error).message}</Notice>
              : preview.data && (
                <div className="grid gap-3">
                  <div className="flex items-center gap-3"><CalendarCheck className="h-8 w-8 text-ok" /><div><p className="font-display text-[22px] font-bold tabular">{preview.data.sessions} classes</p><p className="text-[14px] text-muted">{preview.data.first && formatDate(preview.data.first)} to {preview.data.last && formatDate(preview.data.last)}</p></div></div>
                  {preview.data.clashCount ? (
                    <Notice tone="warn" title={`${preview.data.clashCount} clash${preview.data.clashCount === 1 ? '' : 'es'}`}>
                      <ul className="mt-1 grid gap-1 text-[13.5px]">
                        {preview.data.clashes.slice(0, 6).map((c, i) => <li key={i}><AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{c.kind === 'teacher' ? 'Teacher' : 'Room'} busy {formatDateTime(c.startsAt)} with {c.with}</li>)}
                      </ul>
                      <p className="mt-2 text-[13px]">You can still create the batch and fix individual classes later.</p>
                    </Notice>
                  ) : <Notice tone="ok">No clashes with the teacher's or room's other classes.</Notice>}
                </div>
              )}
          </Card>
        </div>
      </div>
    </>
  );
}
