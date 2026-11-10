import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@cc/shared';
import { Mail, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, SearchInput, Spinner } from '@/components/ui';
import { get, post } from '@/lib/api';

interface Msg { id: string; channel: 'EMAIL' | 'SMS'; to: string; subject: string | null; body: string; status: string; template: string | null; createdAt: string }

/** Test mailbox: every email/SMS the app would have sent (development only). */
export function MailboxPage() {
  const [to, setTo] = useState('');
  const q = useQuery({ queryKey: ['mailbox', to], queryFn: () => get<Msg[]>('/dev/mailbox', { to, take: 100 }), refetchInterval: 4000 });
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="Test mailbox" subtitle="Emails and SMS the app would send. Nothing here leaves this computer." actions={<Link to="/" className="font-semibold text-brand hover:underline">Back to the app</Link>} />
      <DemoClassCard />
      <SearchInput className="mb-4 max-w-sm" value={to} onChange={setTo} placeholder="Filter by email or mobile" />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.length ? <Card><Empty title="No messages yet" /></Card> : (
        <div className="grid gap-3">
          {q.data.map((m) => (
            <Card key={m.id}>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
                {m.channel === 'EMAIL' ? <Mail className="h-4 w-4" /> : <MessageSquareText className="h-4 w-4" />}
                <span className="font-semibold text-fg">{m.to}</span>
                <span>· {formatDateTime(m.createdAt)}</span>
                {m.template && <Badge dot={false}>{m.template}</Badge>}
                <Badge tone={m.status === 'FAILED' ? 'bad' : 'info'}>{m.status}</Badge>
              </div>
              {m.subject && <p className="mt-2 font-bold">{m.subject}</p>}
              <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[14.5px]">{linkify(m.body)}</pre>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Moves the practice class to "now" so the live class room can be tried at any time. */
function DemoClassCard() {
  const [state, setState] = useState<{ busy: boolean; sessionId?: string; error?: string }>({ busy: false });
  const start = async () => {
    setState({ busy: true });
    try {
      const r = await post<{ sessionId: string }>('/dev/demo-class');
      setState({ busy: false, sessionId: r.sessionId });
    } catch (e) {
      setState({ busy: false, error: (e as Error).message });
    }
  };
  return (
    <Card className="mb-5" title="Try a live class">
      <p className="mb-3 text-[14.5px] text-muted">
        The Kochi <b>Live Demo Class</b> (teacher Anita Joseph; students Arjun Nair, Diya Menon and 4 more) can be moved to right now.
        Open it as the teacher in one browser and as a student in another (or a private window).
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="accent" loading={state.busy} onClick={start}>Start the demo class now</Button>
        {state.sessionId && <Link to={`/live/${state.sessionId}`} className="font-semibold text-brand hover:underline">Open the class</Link>}
        {state.error && <span className="text-[14px] text-bad">{state.error}</span>}
      </div>
    </Card>
  );
}

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all font-semibold text-brand underline">{part}</a> : part,
  );
}
