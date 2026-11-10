import { useQuery } from '@tanstack/react-query';
import { PollView, formatTime } from '@cc/shared';
import { Card, Empty, ErrorBox, Spinner } from '@/components/ui';
import { get } from '@/lib/api';

/** Session page tab: every poll asked in the class, with saved results. */
export function PollsTab({ sessionId }: { sessionId: string }) {
  const q = useQuery({ queryKey: ['live-polls', sessionId], queryFn: () => get<PollView[]>(`/live/sessions/${sessionId}/polls`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data?.length) return <Card><Empty title="No polls in this class" /></Card>;
  return (
    <div className="grid gap-3">
      {q.data.map((p) => {
        const total = Math.max(1, p.voters ?? 0);
        return (
          <Card key={p.id} title={p.question}>
            <ul className="grid gap-2" aria-label={`Results: ${p.question}`}>
              {p.options.map((o, i) => {
                const n = p.counts?.[i] ?? 0;
                const pct = Math.round((n / total) * 100);
                return (
                  <li key={i} className="text-[14px]">
                    <div className="flex justify-between gap-2"><span>{o}</span><span className="tabular text-muted">{n} · {pct}%</span></div>
                    <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[13px] text-muted">{p.voters ?? 0} answered · asked at {formatTime(p.createdAt)}{p.multi ? ' · more than one answer allowed' : ''}</p>
          </Card>
        );
      })}
    </div>
  );
}
