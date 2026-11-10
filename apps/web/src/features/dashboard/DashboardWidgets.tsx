import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, PROJECT_STATUS, SESSION_STATUS, formatTime, istDateKey } from '@cc/shared';
import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, Empty, ErrorBox, Spinner, Stat, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { useUser } from '@/lib/auth';
import type { TTItem } from '../academics/TimetablePage';
import { JoinButton, isJoinable } from '../live/JoinButton';

/** Today's classes with Join buttons, for students and teachers. */
function TodayClasses() {
  const today = istDateKey(new Date());
  const from = new Date(`${today}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 86400000);
  const q = useQuery({
    queryKey: ['today-classes', today],
    queryFn: () => get<TTItem[]>('/timetable', { scope: 'me', from: from.toISOString(), to: to.toISOString() }),
    refetchInterval: 60_000,
  });
  const items = q.data ?? [];
  return (
    <Card title="Today's classes" actions={<ButtonLink to="/timetable" size="sm" icon={<CalendarDays className="h-4 w-4" />}>Timetable</ButtonLink>}>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : items.length === 0 ? (
        <Empty title="No classes today" />
      ) : (
        <ul className="divide-y divide-line">
          {items.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <span className="w-[120px] shrink-0 text-[14px] font-semibold tabular">{formatTime(s.startsAt)}–{formatTime(s.endsAt)}</span>
              <Link to={`/timetable/batch/${s.batchId}`} className="min-w-0 flex-1 hover:underline">
                <span className="block truncate text-[14.5px] font-semibold">{s.courseName}</span>
                <span className="block truncate text-[13px] text-muted">{s.branchCode} · {s.batchName} · Class {s.position}{s.teacherName ? ` · ${s.teacherName}` : ''}</span>
              </Link>
              <Badge tone={s.mode === 'OFFLINE' ? 'info' : 'brand'} dot={false}>{BATCH_MODES[s.mode]}</Badge>
              {s.status !== 'SCHEDULED' && <StatusBadge status={s.status} labels={SESSION_STATUS} />}
              {isJoinable(s, s.mode) && <JoinButton sessionId={s.id} label={s.status === 'LIVE' ? 'Join class' : 'Join'} live={s.status === 'LIVE'} />}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** S1: attendance per course, classes to rate, project status. */
function StudentSummary() {
  const att = useQuery({ queryKey: ['my-attendance'], queryFn: () => get<{ batches: { enrolmentId: string; percent: number | null; batch: { id: string; name: string; course: string } }[] }>('/me/attendance') });
  const due = useQuery({ queryKey: ['feedback-due'], queryFn: () => get<unknown[]>('/me/feedback-due') });
  const proj = useQuery({ queryKey: ['my-projects'], queryFn: () => get<{ enrolmentId: string; batch: { name: string }; canSubmit: boolean; project: { status: keyof typeof PROJECT_STATUS } | null }[]>('/me/projects') });
  const todo = [
    ...(due.data?.length ? [{ to: '/learn/performance', text: `Rate ${due.data.length} recent class${due.data.length > 1 ? 'es' : ''}` }] : []),
    ...(proj.data ?? []).filter((p) => p.canSubmit).map((p) => ({ to: '/learn/projects', text: p.project?.status === 'CHANGES_REQUESTED' ? `Your teacher asked for changes to your ${p.batch.name} project` : `Submit your final project for ${p.batch.name}` })),
  ];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Attendance" actions={<ButtonLink to="/learn/attendance" size="sm">Details</ButtonLink>}>
        {att.isLoading ? <Spinner /> : !att.data?.batches.length ? <p className="text-[14px] text-muted">No classes yet.</p> : (
          <ul className="grid gap-2">
            {att.data.batches.map((b) => (
              <li key={b.enrolmentId} className="flex items-center justify-between gap-3 text-[14.5px]">
                <span className="min-w-0 truncate">{b.batch.course} · {b.batch.name}</span>
                <b className={`tabular ${b.percent !== null && b.percent < 75 ? 'text-bad' : ''}`}>{b.percent === null ? '–' : `${b.percent}%`}</b>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="To do">
        {!todo.length ? <p className="text-[14px] text-muted">You're all caught up.</p> : (
          <ul className="grid gap-2">{todo.map((t, i) => <li key={i}><Link to={t.to} className="text-[14.5px] font-semibold text-brand hover:underline">{t.text}</Link></li>)}</ul>
        )}
        {(proj.data ?? []).filter((p) => p.project && !p.canSubmit).map((p) => (
          <p key={p.enrolmentId} className="mt-2 text-[14px]">Final project ({p.batch.name}): <StatusBadge status={p.project!.status} labels={PROJECT_STATUS} /></p>
        ))}
      </Card>
    </div>
  );
}

/** T1: what is waiting for the teacher. */
function TeacherSummary() {
  const user = useUser();
  const reqs = useQuery({ queryKey: ['att-requests', 'open', 1], queryFn: () => get<{ total: number }>('/attendance/requests', { status: 'open', page: 1 }) });
  const projects = useQuery({ queryKey: ['projects', 'review'], queryFn: () => get<unknown[]>('/projects', { stage: 'review' }), enabled: user.permissions.includes('projects.review') });
  const fb = useQuery({ queryKey: ['feedback-received'], queryFn: () => get<{ batches: { classAverage: number | null; classRatings: number }[] }>('/feedback/received') });
  const ratings = (fb.data?.batches ?? []).filter((b) => b.classAverage !== null);
  const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + (b.classAverage ?? 0) * b.classRatings, 0) / Math.max(1, ratings.reduce((a, b) => a + b.classRatings, 0))) * 10) / 10 : null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Link to="/teach/attendance-requests" className="block"><Stat label="Attendance requests waiting" value={reqs.data?.total ?? '–'} tone={reqs.data?.total ? 'warn' : undefined} /></Link>
      <Link to="/teach/projects" className="block"><Stat label="Projects to review" value={projects.data?.length ?? '–'} tone={projects.data?.length ? 'warn' : undefined} /></Link>
      <Link to="/teach/feedback" className="block"><Stat label="Your class rating" value={avg === null ? '–' : `${avg} ★`} /></Link>
    </div>
  );
}

/** Role dashboards are filled in as each phase lands (Phase 5 student/teacher, Phase 9 admin/branch). */
export function DashboardWidgets() {
  const user = useUser();
  const showsClasses = user.kind === 'STUDENT' || user.permissions.includes('sessions.teach');
  return (
    <div className="grid gap-5">
      {user.kind === 'EMPLOYEE' && user.permissions.includes('sessions.teach') && <TeacherSummary />}
      {showsClasses && <TodayClasses />}
      {user.kind === 'STUDENT' && <StudentSummary />}
      {!showsClasses && (
        <Card>
          <p className="text-[14.5px] text-muted">Your dashboard will show branch performance, dues and messages here as those parts are built.</p>
        </Card>
      )}
    </div>
  );
}
