import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PROJECT_STATUS, formatDate } from '@cc/shared';
import { FileText, FolderKanban, Link2, Star } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Spinner, Stat, StatusBadge, Textarea, useToast } from '@/components/ui';
import { get, post } from '@/lib/api';
import { openMaterial } from './MaterialsTab';
import { ProjectHistory, ProjectView } from './StudentLearningPages';

/** T8 (teacher reviews) and BA10 (Branch Admin final approvals). */
export function ProjectQueuePage({ stage }: { stage: 'review' | 'approve' }) {
  const q = useQuery({ queryKey: ['projects', stage], queryFn: () => get<ProjectView[]>('/projects', { stage }) });
  return (
    <>
      <PageHeader title={stage === 'review' ? 'Project reviews' : 'Project approvals'}
        subtitle={stage === 'review' ? 'Final projects your students submitted. Approve them, or ask for changes.' : 'Projects the teacher approved. Your approval marks the course Completed.'} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? (
        <Card><Empty title={stage === 'review' ? 'No projects waiting for review' : 'No projects waiting for approval'} icon={<FolderKanban className="h-8 w-8" />} /></Card>
      ) : (
        <Card padded={false}>
          <ul className="divide-y divide-line" aria-label="Projects">
            {q.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link to={`/projects/${p.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block font-semibold">{p.student.name} · {p.submissions[0]?.title}</span>
                  <span className="block text-[13px] text-muted">{p.batch.branch} · {p.batch.name} · version {p.submissions[0]?.version} · {formatDate(p.updatedAt)}</span>
                </Link>
                <StatusBadge status={p.status} labels={PROJECT_STATUS} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['project', id], queryFn: () => get<ProjectView>(`/projects/${id}`) });
  const [comment, setComment] = useState('');
  const review = useMutation({
    mutationFn: (decision: string) => post<{ status: string }>(`/projects/${id}/review`, { decision, comment: comment || undefined }),
    onSuccess: (r) => {
      toast(r.status === 'COMPLETED' ? 'Approved. The course is marked Completed.' : r.status === 'TEACHER_APPROVED' ? 'Approved and sent to the Branch Admin' : 'Saved. The student has been told.');
      setComment('');
      void qc.invalidateQueries({ queryKey: ['project', id] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const p = q.data;
  const acting = p.canReview || p.canApprove;
  return (
    <>
      <PageHeader back={{ to: p.canApprove ? '/project-approvals' : '/teach/projects', label: p.canApprove ? 'Project approvals' : 'Project reviews' }}
        title={`${p.student.name}: final project`} subtitle={`${p.batch.course} · ${p.batch.name} · ${p.batch.branch} · ${p.student.code}`}
        actions={<StatusBadge status={p.status} labels={PROJECT_STATUS} />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <Card title="Submissions and reviews"><ProjectHistory p={p} /></Card>
        {acting && (
          <Card title={p.canReview ? 'Your review' : 'Final approval'}>
            <div className="grid gap-3">
              <Textarea label={p.canReview ? 'Comments for the student' : 'Comments'} value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={3000} />
              <Button loading={review.isPending && review.variables === 'APPROVE'} onClick={() => review.mutate('APPROVE')}>{p.canReview ? 'Approve' : 'Approve and complete the course'}</Button>
              {p.canReview
                ? <Button variant="secondary" disabled={comment.trim().length < 3} onClick={() => review.mutate('CHANGES')}>Request changes</Button>
                : <Button variant="secondary" disabled={comment.trim().length < 3} onClick={() => review.mutate('SEND_BACK')}>Send back to the teacher</Button>}
              <Button variant="danger" disabled={comment.trim().length < 3} onClick={() => review.mutate('REJECT')}>Reject</Button>
              <p className="text-[12.5px] text-muted">Requesting changes, sending back or rejecting needs a comment.</p>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

interface Received {
  showNames: boolean;
  batches: { batch: { id: string; name: string; branch: string }; classAverage: number | null; classRatings: number; courseAverage: number | null; courseRatings: number; comments: { id: string; kind: string; rating: number | null; comment: string | null; createdAt: string; classPosition: number | null; from: string | null }[] }[];
}

/** T7 Feedback: what students said about my classes. */
export function TeacherFeedbackPage() {
  const q = useQuery({ queryKey: ['feedback-received'], queryFn: () => get<Received>('/feedback/received') });
  return (
    <>
      <PageHeader title="Feedback" subtitle="Ratings students gave your classes and courses. Give feedback to a student from the Progress tab of a batch." />
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data.batches.length ? <Card><Empty title="No ratings yet" icon={<Star className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-5">
          {q.data.batches.map((b) => (
            <Card key={b.batch.id} title={`${b.batch.branch} · ${b.batch.name}`}>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <Stat label={`Class rating (${b.classRatings})`} value={b.classAverage === null ? '–' : `${b.classAverage} ★`} />
                <Stat label={`Course rating (${b.courseRatings})`} value={b.courseAverage === null ? '–' : `${b.courseAverage} ★`} />
              </div>
              {b.comments.length ? (
                <ul className="grid gap-2" aria-label={`Comments in ${b.batch.name}`}>
                  {b.comments.map((c) => (
                    <li key={c.id} className="rounded-lg bg-surface-2 p-3 text-[14.5px]">
                      <div className="text-[13px] text-muted">{c.rating ? `${c.rating} ★ · ` : ''}{c.classPosition ? `Class ${c.classPosition}` : 'Course'} · {formatDate(c.createdAt)}{c.from ? ` · ${c.from}` : ''}</div>
                      <p>{c.comment}</p>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-[14px] text-muted">No comments yet.</p>}
              {!q.data.showNames && <p className="mt-3 text-[12.5px] text-muted">Students' names are not shown, so they can be honest.</p>}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

interface MyMaterial { id: string; title: string; kind: string; createdAt: string; course: { name: string }; module: { title: string } | null; shares: { batch: { id: string; name: string; branch: { code: string } } }[] }

/** T6 Materials: everything I shared, and with which batches. */
export function MyMaterialsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-materials'], queryFn: () => get<MyMaterial[]>('/teach/materials') });
  return (
    <>
      <PageHeader title="Materials" subtitle="Notes, slides and links you shared. Add new ones from a batch's Materials tab." />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title="You have not shared any materials yet" icon={<FileText className="h-8 w-8" />} /></Card> : (
        <Card padded={false}>
          <ul className="divide-y divide-line" aria-label="My materials">
            {q.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {m.kind === 'LINK' ? <Link2 className="h-5 w-5 text-brand" /> : <FileText className="h-5 w-5 text-brand" />}
                <div className="min-w-0 flex-1">
                  <button type="button" className="text-left font-semibold text-brand hover:underline" onClick={() => void openMaterial(m.id).catch((e) => toast((e as Error).message, 'bad'))}>{m.title}</button>
                  <div className="text-[13px] text-muted">{m.course.name}{m.module ? ` · ${m.module.title}` : ''} · {formatDate(m.createdAt)}</div>
                </div>
                <div className="flex flex-wrap gap-1">{m.shares.map((s) => <Link key={s.batch.id} to={`/teach/batches/${s.batch.id}`}><Badge dot={false}>{s.batch.branch.code} · {s.batch.name}</Badge></Link>)}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
