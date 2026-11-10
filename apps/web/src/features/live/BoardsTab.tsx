import { useQuery } from '@tanstack/react-query';
import { formatTime } from '@cc/shared';
import { Card, Empty, ErrorBox, Spinner } from '@/components/ui';
import { get } from '@/lib/api';

/** Session page tab: whiteboards the teacher saved during the class. */
export function BoardsTab({ sessionId }: { sessionId: string }) {
  const q = useQuery({ queryKey: ['boards', sessionId], queryFn: () => get<{ id: string; title: string; createdAt: string; url: string | null }[]>(`/live/sessions/${sessionId}/boards`) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (!q.data?.length) return <Card><Empty title="No whiteboards saved in this class" /></Card>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {q.data.map((b) => (
        <Card key={b.id} title={b.title}>
          {b.url && <a href={b.url} target="_blank" rel="noreferrer"><img src={b.url} alt={b.title} className="w-full rounded-lg border border-line bg-white" /></a>}
          <p className="mt-2 text-[13px] text-muted">Saved at {formatTime(b.createdAt)}. Shared with the batch in its materials.</p>
        </Card>
      ))}
    </div>
  );
}
