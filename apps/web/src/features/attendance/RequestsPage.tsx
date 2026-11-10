import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ATTENDANCE_STATUS, ATT_REQUEST_STATUS, formatDateTime, formatTime, formatWeekdayDate } from '@cc/shared';
import { Inbox, Paperclip } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Pagination, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { Paged } from '@/components/data';
import { get, post } from '@/lib/api';
import { AttRequestRow } from './types';

const TONE = { PENDING: 'warn', ESCALATED: 'bad', APPROVED: 'ok', REJECTED: 'neutral' } as const;

export function RequestsList({ status, emptyText }: { status: 'open' | 'closed'; emptyText: string }) {
  const [page, setPage] = useState(1);
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['att-requests', status, page], queryFn: () => get<Paged<AttRequestRow>>('/attendance/requests', { status, page }) });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; status?: 'PRESENT' | 'LATE'; note?: string }) => post(`/attendance/requests/${v.id}/decision`, { approve: v.approve, status: v.status, note: v.note }),
    onSuccess: (_d, v) => { toast(v.approve ? 'Approved. The student has been told.' : 'Rejected. The student has been told.'); void qc.invalidateQueries({ queryKey: ['att-requests'] }); void qc.invalidateQueries({ queryKey: ['attendance-overview'] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const reject = async (r: AttRequestRow) => {
    const c = await confirm({ title: `Reject ${r.student.user.name}'s request?`, body: 'The student will see your reason.', confirmLabel: 'Reject', danger: true, requireReason: true, reasonLabel: 'Reason for the student' });
    if (c.ok) decide.mutate({ id: r.id, approve: false, note: c.reason });
  };
  const openShot = async (id: string) => {
    try {
      const { url } = await get<{ url: string }>(`/attendance/requests/${id}/attachment`);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast((e as Error).message, 'bad'); }
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data?.rows.length) return <Card><Empty title={emptyText} icon={<Inbox className="h-8 w-8" />} /></Card>;
  return (
    <div className="grid gap-3">
      {q.data.rows.map((r) => (
        <Card key={r.id}>
          <section aria-label={`Request from ${r.student.user.name}`} className="flex flex-col gap-3 md:flex-row md:items-start">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[16px] font-bold">{r.student.user.name}</span>
                <span className="text-[13px] text-muted">{r.student.code}</span>
                <Badge tone={TONE[r.status]}>{ATT_REQUEST_STATUS[r.status]}</Badge>
              </div>
              <p className="text-[14px] text-muted">
                <Link className="text-brand hover:underline" to={`/sessions/${r.session.id}`}>{r.session.batch.branch.code} · {r.session.batch.name}, class {r.session.position}</Link> · {formatWeekdayDate(r.session.startsAt)}, {formatTime(r.session.startsAt)}
              </p>
              <p className="mt-1.5 text-[14.5px]"><b>{r.reason}</b>{r.note ? `: ${r.note}` : ''}</p>
              <p className="text-[12.5px] text-muted">Sent {formatDateTime(r.createdAt)}{r.escalatedAt ? ` · escalated ${formatDateTime(r.escalatedAt)}` : ''}{r.decidedAt ? ` · decided ${formatDateTime(r.decidedAt)}` : ''}</p>
              {r.decisionNote && <p className="text-[13.5px]">Note: {r.decisionNote}</p>}
              {r.grantedStatus && <p className="text-[13.5px]">Marked {ATTENDANCE_STATUS[r.grantedStatus]}</p>}
              {r.attachmentId && <Button className="mt-2" size="sm" variant="ghost" icon={<Paperclip className="h-4 w-4" />} onClick={() => void openShot(r.id)}>View screenshot</Button>}
            </div>
            {r.canDecide && (
              <div className="flex flex-wrap gap-2 md:flex-col">
                <Button size="sm" loading={decide.isPending && decide.variables?.id === r.id && decide.variables.status === 'PRESENT'} onClick={() => decide.mutate({ id: r.id, approve: true, status: 'PRESENT' })}>Approve as Present</Button>
                <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: r.id, approve: true, status: 'LATE' })}>Approve as Late</Button>
                <Button size="sm" variant="danger" onClick={() => void reject(r)}>Reject</Button>
              </div>
            )}
          </section>
        </Card>
      ))}
      <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
    </div>
  );
}

/** T5 Attendance requests (teacher). Branch Admins see the same list for the whole branch. */
export function RequestsPage() {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  return (
    <>
      <PageHeader title="Attendance requests" subtitle="Students who missed being marked. Requests you don't decide within 2 days go to the Branch Admin." />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'open', label: 'Waiting' }, { id: 'closed', label: 'Decided' }]} />
      <RequestsList status={tab} emptyText={tab === 'open' ? 'No requests waiting' : 'No decided requests yet'} />
    </>
  );
}
