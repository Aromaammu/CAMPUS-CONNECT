import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, ENROLMENT_STATUS, formatDateTime, formatDays, formatHHMM } from '@cc/shared';
import { BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from '@/components/ui';
import { get } from '@/lib/api';
import { HoursBar } from '../academics/BatchDetailPage';
import { JoinButton, isJoinable } from '../live/JoinButton';

interface MyEnrolment {
  id: string; status: keyof typeof ENROLMENT_STATUS; batchId: string;
  batch: {
    id: string; name: string; mode: keyof typeof BATCH_MODES; days: number[]; startTime: string; endTime: string; room: { name: string } | null;
    course: { id: string; name: string; code: string; totalMinutes: number }; branch: { code: string; name: string };
    teachers: { role: string; employee: { user: { id: string; name: string } } }[];
  };
  hours: { deliveredMinutes: number; scheduledMinutes: number };
  nextSession: { id: string; startsAt: string; endsAt: string; status: string } | null;
}

export function MyCoursesPage() {
  const q = useQuery({ queryKey: ['my-enrolments'], queryFn: () => get<MyEnrolment[]>('/me/enrolments') });
  return (
    <>
      <PageHeader title="My courses" subtitle="Your batches, timings and progress" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <Card><Empty title="You are not enrolled in any course yet" icon={<BookOpen className="h-8 w-8" />}>Your branch will enrol you in a batch.</Empty></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {q.data.map((e) => {
            const teacher = e.batch.teachers.find((t) => t.role === 'MAIN')?.employee.user.name;
            return (
              <div key={e.id} className="card relative flex flex-col gap-3 p-5 transition-colors hover:border-brand/50">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] text-muted">{e.batch.branch.name}</span>
                  <span className="flex gap-1.5"><Badge tone="brand" dot={false}>{BATCH_MODES[e.batch.mode]}</Badge><StatusBadge status={e.status} labels={ENROLMENT_STATUS} /></span>
                </div>
                <div>
                  <h2 className="text-[19px] font-bold"><Link to={`/learn/courses/${e.batch.id}`} aria-label={`${e.batch.course.name}, ${e.batch.name}`} className="after:absolute after:inset-0 after:content-['']">{e.batch.course.name}</Link></h2>
                  <p className="text-[14.5px] text-muted">{e.batch.name} · {formatDays(e.batch.days)} {formatHHMM(e.batch.startTime)}–{formatHHMM(e.batch.endTime)}{e.batch.room ? ` · ${e.batch.room.name}` : ''}</p>
                  {teacher && <p className="text-[14.5px]">Teacher: {teacher}</p>}
                </div>
                <HoursBar delivered={e.hours.deliveredMinutes} scheduled={e.hours.scheduledMinutes} total={e.batch.course.totalMinutes} />
                {e.nextSession && (
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[14px] font-semibold text-accent">{e.nextSession.status === 'LIVE' ? 'Class is live now' : `Next class ${formatDateTime(e.nextSession.startsAt)}`}</p>
                    {e.status === 'ACTIVE' && isJoinable(e.nextSession, e.batch.mode) && <span className="relative z-10"><JoinButton sessionId={e.nextSession.id} label="Join class" live={e.nextSession.status === 'LIVE'} /></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
