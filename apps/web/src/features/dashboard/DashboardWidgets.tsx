import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, SESSION_STATUS, formatTime, istDateKey } from '@cc/shared';
import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, Empty, ErrorBox, Spinner, StatusBadge } from '@/components/ui';
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

/** Role dashboards are filled in as each phase lands (Phase 5 student/teacher, Phase 9 admin/branch). */
export function DashboardWidgets() {
  const user = useUser();
  const showsClasses = user.kind === 'STUDENT' || user.permissions.includes('sessions.teach');
  return (
    <div className="grid gap-5">
      {showsClasses && <TodayClasses />}
      {!showsClasses && (
        <Card>
          <p className="text-[14.5px] text-muted">Your dashboard will show branch performance, dues and messages here as those parts are built.</p>
        </Card>
      )}
    </div>
  );
}
