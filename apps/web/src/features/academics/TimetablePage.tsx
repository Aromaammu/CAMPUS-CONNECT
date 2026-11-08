import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, WEEKDAYS, formatTime, istDateKey } from '@cc/shared';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Select, Spinner, Tabs, clsx } from '@/components/ui';
import { BranchSelect } from '@/components/data';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { TIMETABLE_ACTIONS } from './timetableActions';

export interface TTItem {
  id: string; batchId: string; position: number; startsAt: string; endsAt: string; status: string; cancelReason: string | null; topic: string | null;
  batchName: string; mode: keyof typeof BATCH_MODES; branchCode: string; courseName: string; teacherName: string | null; substitute: boolean; room: string | null;
}

type View = 'week' | 'month' | 'list';
const addDays = (k: string, n: number) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (k: string) => new Date(`${k}T00:00:00Z`).getUTCDay();
const startOfWeek = (k: string) => addDays(k, -((dow(k) + 6) % 7));
const monthLabel = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (k: string) => new Date(`${k}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export function TimetablePage() {
  const { user, can } = useAuth();
  const staffBranch = user?.kind !== 'STUDENT' && can('batches.view');
  const [scope, setScope] = useState<'me' | 'branch'>(user?.kind === 'EMPLOYEE' && user.permissions.includes('sessions.teach') ? 'me' : staffBranch ? 'branch' : 'me');
  const [branchId, setBranchId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [view, setView] = useState<View>(typeof window !== 'undefined' && window.innerWidth < 768 ? 'list' : 'week');
  const today = istDateKey(new Date());
  const [anchor, setAnchor] = useState(today);
  const range = useMemo(() => {
    if (view === 'month') {
      const first = `${anchor.slice(0, 8)}01`;
      const from = startOfWeek(first);
      return { from, days: 42 };
    }
    if (view === 'week') return { from: startOfWeek(anchor), days: 7 };
    return { from: anchor, days: 14 };
  }, [view, anchor]);
  const to = addDays(range.from, range.days);
  const teachers = useQuery({ queryKey: ['teachers', branchId], queryFn: () => get<{ id: string; name: string }[]>('/employees/options', { branchId, perm: 'sessions.teach' }), enabled: scope === 'branch' && !!branchId });
  const q = useQuery({
    queryKey: ['timetable', scope, branchId, teacherId, range.from, to],
    queryFn: () => get<TTItem[]>('/timetable', { scope, branchId, teacherId, from: new Date(`${range.from}T00:00:00+05:30`).toISOString(), to: new Date(`${to}T00:00:00+05:30`).toISOString() }),
  });
  const byDay = useMemo(() => {
    const m = new Map<string, TTItem[]>();
    for (const s of q.data ?? []) { const k = istDateKey(s.startsAt); m.set(k, [...(m.get(k) ?? []), s]); }
    return m;
  }, [q.data]);
  const step = (n: number) => setAnchor((a) => view === 'month' ? addDays(`${a.slice(0, 8)}01`, n * 32).slice(0, 8) + '01' : addDays(a, n * (view === 'week' ? 7 : 14)));
  const days = Array.from({ length: range.days }, (_, i) => addDays(range.from, i));
  const title = view === 'month' ? monthLabel(`${anchor.slice(0, 8)}01`) : `${dayLabel(range.from)} – ${dayLabel(addDays(range.from, range.days - 1))}`;
  return (
    <>
      <PageHeader title="Timetable" subtitle={scope === 'me' ? (user?.kind === 'STUDENT' ? 'All your classes, across every batch' : 'Every class you teach') : 'Classes in the branch'} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {staffBranch && user?.kind === 'EMPLOYEE' && user.permissions.includes('sessions.teach') && (
          <Tabs value={scope} onChange={setScope} tabs={[{ id: 'me', label: 'My classes' }, { id: 'branch', label: 'Branch' }]} />
        )}
        {scope === 'branch' && <BranchSelect className="w-60" allowAll={user?.branchIds === null} perm="batches.view" value={branchId} onChange={(v) => { setBranchId(v); setTeacherId(''); }} />}
        {scope === 'branch' && branchId && <Select className="w-52" label="Teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)} placeholder="All teachers" options={(teachers.data ?? []).map((t) => ({ value: t.id, label: t.name }))} />}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="secondary" onClick={() => setAnchor(today)}>Today</Button>
          <Button size="sm" variant="secondary" aria-label="Next" onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></Button>
          <h2 className="ml-2 text-[16px] font-bold">{title}</h2>
        </div>
        <Tabs value={view} onChange={setView} tabs={[{ id: 'list', label: 'List' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : view === 'list' ? (
        <ListView days={days} byDay={byDay} today={today} />
      ) : view === 'week' ? (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => (
            <div key={d} className={clsx('card min-h-[140px] p-2', d === today && 'border-accent')}>
              <p className={clsx('mb-2 px-1 text-[13px] font-bold', d === today ? 'text-accent' : 'text-muted')}>{dayLabel(d)}</p>
              <div className="grid gap-1.5">{(byDay.get(d) ?? []).map((s) => <Chip key={s.id} s={s} />)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 gap-1">
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <div key={d} className="px-2 py-1 text-[12px] font-bold uppercase text-muted">{WEEKDAYS[d]}</div>)}
            {days.map((d) => (
              <div key={d} className={clsx('card min-h-[96px] p-1.5', d.slice(0, 7) !== anchor.slice(0, 7) && 'opacity-50', d === today && 'border-accent')}>
                <p className={clsx('px-1 text-[12px] font-bold', d === today ? 'text-accent' : 'text-muted')}>{Number(d.slice(8))}</p>
                <div className="grid gap-1">{(byDay.get(d) ?? []).slice(0, 3).map((s) => <Chip key={s.id} s={s} compact />)}{(byDay.get(d)?.length ?? 0) > 3 && <span className="px-1 text-[11.5px] text-muted">+{byDay.get(d)!.length - 3} more</span>}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ s, compact }: { s: TTItem; compact?: boolean }) {
  const cancelled = s.status === 'CANCELLED';
  const live = s.status === 'LIVE';
  return (
    <Link to={batchLink(s)} className={clsx('block rounded-md border-l-[3px] px-2 py-1 text-[12.5px] leading-tight hover:bg-surface-2',
      cancelled ? 'border-bad bg-bad-soft/50 line-through opacity-70' : live ? 'border-accent bg-accent-soft' : s.mode === 'OFFLINE' ? 'border-info bg-info-soft/60' : 'border-brand bg-brand-soft/60')}>
      <span className="block font-semibold tabular">{formatTime(s.startsAt)}{live && ' · Live'}</span>
      <span className="block truncate">{s.batchName}</span>
      {!compact && <span className="block truncate text-muted">{s.courseName}{s.room ? ` · ${s.room}` : ''}</span>}
    </Link>
  );
}

export function batchLink(s: Pick<TTItem, 'batchId'>) {
  return `/timetable/batch/${s.batchId}`;
}

function ListView({ days, byDay, today }: { days: string[]; byDay: Map<string, TTItem[]>; today: string }) {
  const withClasses = days.filter((d) => byDay.get(d)?.length);
  if (!withClasses.length) return <Card><Empty title="No classes in these days" icon={<CalendarDays className="h-8 w-8" />} /></Card>;
  return (
    <div className="grid gap-4">
      {withClasses.map((d) => (
        <section key={d}>
          <h3 className={clsx('mb-2 text-[14px] font-bold', d === today ? 'text-accent' : 'text-muted')}>{d === today ? 'Today · ' : ''}{dayLabel(d)}</h3>
          <ul className="grid gap-2">
            {byDay.get(d)!.map((s) => (
              <li key={s.id} className={clsx('card flex flex-wrap items-center gap-3 px-4 py-3', s.status === 'CANCELLED' && 'opacity-60')}>
                <span className="w-24 shrink-0 font-semibold tabular">{formatTime(s.startsAt)}<span className="block text-[12.5px] font-normal text-muted">to {formatTime(s.endsAt)}</span></span>
                <Link to={batchLink(s)} className="min-w-0 flex-1 hover:underline">
                  <span className={clsx('block font-semibold', s.status === 'CANCELLED' && 'line-through')}>{s.courseName}</span>
                  <span className="block text-[13px] text-muted">{s.branchCode} · {s.batchName} · {s.teacherName}{s.substitute ? ' (substitute)' : ''}{s.room ? ` · ${s.room}` : ''}</span>
                  {s.cancelReason && <span className="block text-[13px] text-bad">Cancelled: {s.cancelReason}</span>}
                </Link>
                <Badge tone={s.mode === 'OFFLINE' ? 'info' : 'brand'} dot={false}>{BATCH_MODES[s.mode]}</Badge>
                {TIMETABLE_ACTIONS.map((A, i) => <A key={i} item={s} />)}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
