import { useQuery } from '@tanstack/react-query';
import { BATCH_STATUS } from '@cc/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Empty, ErrorBox, PageHeader, Spinner, Stat, StatusBadge, Tabs } from '@/components/ui';
import { BranchSelect } from '@/components/data';
import { get } from '@/lib/api';
import { RequestsList } from './RequestsPage';

interface Overview {
  threshold: number;
  batches: { id: string; name: string; course: string; branch: string; status: keyof typeof BATCH_STATUS; percent: number | null; marked: number }[];
  low: { studentId: string; name: string; code: string; batch: string; batchId: string; percent: number }[];
  requests: { escalated: number; pending: number };
}

/** BA11 Attendance overview & escalations. */
export function OverviewPage() {
  const [branchId, setBranchId] = useState('');
  const [tab, setTab] = useState<'requests' | 'batches' | 'low'>('requests');
  const q = useQuery({ queryKey: ['attendance-overview', branchId], queryFn: () => get<Overview>('/attendance/overview', { branchId }) });
  return (
    <>
      <PageHeader title="Attendance" subtitle="Requests waiting for you, attendance by batch, and students below the minimum." />
      <div className="mb-4 max-w-xs"><BranchSelect perm="attendance.oversee" allowAll value={branchId} onChange={setBranchId} /></div>
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Escalated to you" value={q.data.requests.escalated} tone={q.data.requests.escalated ? 'bad' : undefined} />
            <Stat label="With teachers" value={q.data.requests.pending} />
            <Stat label={`Below ${q.data.threshold}%`} value={q.data.low.length} tone={q.data.low.length ? 'warn' : undefined} />
            <Stat label="Batches" value={q.data.batches.length} />
          </div>
          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'requests', label: 'Requests', count: q.data.requests.escalated + q.data.requests.pending }, { id: 'batches', label: 'By batch' }, { id: 'low', label: 'Low attendance', count: q.data.low.length }]} />
          {tab === 'requests' && <RequestsList status="open" emptyText="No attendance requests waiting" />}
          {tab === 'batches' && (
            <Card padded={false}>
              {!q.data.batches.length ? <Empty title="No running batches" /> : (
                <ul className="divide-y divide-line">
                  {q.data.batches.map((b) => (
                    <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Link to={`/batches/${b.id}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block font-semibold">{b.branch} · {b.name}</span>
                        <span className="block text-[13px] text-muted">{b.course}</span>
                      </Link>
                      <StatusBadge status={b.status} labels={BATCH_STATUS} />
                      <span className={`w-16 text-right text-[18px] font-bold tabular ${b.percent !== null && b.percent < q.data.threshold ? 'text-bad' : ''}`}>{b.percent === null ? '–' : `${b.percent}%`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {tab === 'low' && (
            <Card padded={false}>
              {!q.data.low.length ? <Empty title={`Every student is at ${q.data.threshold}% or above`} /> : (
                <ul className="divide-y divide-line" aria-label="Low attendance">
                  {q.data.low.map((s) => (
                    <li key={`${s.studentId}-${s.batchId}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                      <Link to={`/students/${s.studentId}`} className="min-w-0 flex-1 hover:underline">
                        <span className="block font-semibold">{s.name} <span className="font-normal text-muted">{s.code}</span></span>
                        <span className="block text-[13px] text-muted">{s.batch}</span>
                      </Link>
                      <span className="text-[18px] font-bold tabular text-bad">{s.percent}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
