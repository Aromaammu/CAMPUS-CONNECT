import { useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@cc/shared';
import { Mail, MessageSquareText } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, PageHeader, SearchInput, Spinner } from '@/components/ui';
import { get } from '@/lib/api';

interface Msg { id: string; channel: 'EMAIL' | 'SMS'; to: string; subject: string | null; body: string; status: string; template: string | null; createdAt: string }

/** Test mailbox: every email/SMS the app would have sent (development only). */
export function MailboxPage() {
  const [to, setTo] = useState('');
  const q = useQuery({ queryKey: ['mailbox', to], queryFn: () => get<Msg[]>('/dev/mailbox', { to, take: 100 }), refetchInterval: 4000 });
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <PageHeader title="Test mailbox" subtitle="Emails and SMS the app would send. Nothing here leaves this computer." actions={<Link to="/" className="font-semibold text-brand hover:underline">Back to the app</Link>} />
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

function linkify(text: string) {
  return text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? <a key={i} href={part.replace(/^https?:\/\/[^/]+/, '')} className="break-all font-semibold text-brand underline">{part}</a> : part,
  );
}
