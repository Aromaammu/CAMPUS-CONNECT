import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatTime, istDateKey } from '@cc/shared';
import clsx from 'clsx';
import { MessageSquarePlus, MessagesSquare, Users } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Button, Empty, ErrorBox, SearchInput, Spinner } from '@/components/ui';
import { useDebounced } from '@/components/data';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRealtime } from '@/lib/realtime';
import { NewChatDialog, NewGroupDialog } from './dialogs';
import { ConvSummary, Thread } from './Thread';

const when = (d: string) => (istDateKey(d) === istDateKey(new Date()) ? formatTime(d) : formatDate(d));

/** C1 Messages: conversations on the left, the open chat on the right (one at a time on phones). */
export function MessagesPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 300);
  const [dialog, setDialog] = useState<'chat' | 'group' | null>(null);
  const list = useQuery({ queryKey: ['conversations'], queryFn: () => get<ConvSummary[]>('/messages/conversations') });
  const search = useQuery({
    queryKey: ['message-search', term],
    queryFn: () => get<{ id: string; conversationId: string; conversationTitle: string | null; sender: string; text: string; createdAt: string }[]>('/messages/search', { q: term }),
    enabled: term.trim().length >= 2,
  });
  useRealtime('message', () => void qc.invalidateQueries({ queryKey: ['conversations'] }));
  useRealtime('conversation', () => void qc.invalidateQueries({ queryKey: ['conversations'] }));
  const titleOf = (cid: string) => list.data?.find((c) => c.id === cid)?.title;

  return (
    <div className="-my-6 flex h-[calc(100dvh-57px)] overflow-hidden border-x border-line bg-surface md:mx-0" style={{ marginLeft: 'calc(-1 * max(16px, env(safe-area-inset-left)))', marginRight: 'calc(-1 * max(16px, env(safe-area-inset-right)))' }}>
      <aside className={clsx('flex w-full shrink-0 flex-col border-r border-line md:w-[340px]', id && 'hidden md:flex')} aria-label="Conversations">
        <div className="grid gap-2 border-b border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-[20px] font-bold">Messages</h1>
            <div className="flex gap-1">
              <Button size="sm" variant="secondary" icon={<MessageSquarePlus className="h-4 w-4" />} onClick={() => setDialog('chat')}>New chat</Button>
              {user?.permissions.includes('messaging.groups') && <Button size="sm" variant="ghost" aria-label="New staff group" icon={<Users className="h-4 w-4" />} onClick={() => setDialog('group')} />}
            </div>
          </div>
          <SearchInput value={q} onChange={setQ} placeholder="Search messages" id="msg-search" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {term.trim().length >= 2 ? (
            search.isLoading ? <Spinner /> : !search.data?.length ? <p className="p-4 text-[14px] text-muted">No messages found.</p> : (
              <ul aria-label="Search results">
                {search.data.map((r) => (
                  <li key={r.id}><Link to={`/messages/${r.conversationId}`} onClick={() => setQ('')} className="block border-b border-line px-3 py-2.5 hover:bg-surface-2">
                    <div className="text-[12.5px] text-muted">{titleOf(r.conversationId) ?? r.conversationTitle ?? 'Chat'} · {when(r.createdAt)}</div>
                    <div className="truncate text-[14px]"><b>{r.sender}:</b> {r.text}</div>
                  </Link></li>
                ))}
              </ul>
            )
          ) : list.isLoading ? <Spinner /> : list.error ? <div className="p-3"><ErrorBox error={list.error} retry={list.refetch} /></div> : !list.data?.length ? (
            <Empty title="No conversations yet" icon={<MessagesSquare className="h-8 w-8" />}>Start a chat with your teacher or a colleague.</Empty>
          ) : (
            <ul aria-label="Conversation list">
              {list.data.map((c) => (
                <li key={c.id}>
                  <Link to={`/messages/${c.id}`} className={clsx('flex items-center gap-2.5 border-b border-line px-3 py-2.5 hover:bg-surface-2', c.id === id && 'bg-brand-soft')} aria-label={`${c.title}${c.unread ? `, ${c.unread} unread` : ''}`}>
                    <Avatar name={c.title} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={clsx('truncate text-[14.5px]', c.unread ? 'font-bold' : 'font-semibold')}>{c.title}</span>
                        {c.last && <span className="shrink-0 text-[11.5px] text-muted">{when(c.last.createdAt)}</span>}
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-[13px] text-muted">{c.last ? `${c.last.mine ? 'You' : c.kind === 'DIRECT' ? '' : c.last.sender.split(' ')[0]}${c.last.mine || c.kind !== 'DIRECT' ? ': ' : ''}${c.last.text}` : c.subtitle}</span>
                        {c.unread > 0 && <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-bold leading-[18px] text-white">{c.unread}</span>}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
      <section className={clsx('min-w-0 flex-1', !id && 'hidden md:block')}>
        {id ? <Thread key={id} id={id} backTo="/messages" /> : <div className="flex h-full items-center justify-center"><Empty title="Choose a conversation" icon={<MessagesSquare className="h-8 w-8" />} /></div>}
      </section>
      {dialog === 'chat' && <NewChatDialog onClose={() => setDialog(null)} />}
      {dialog === 'group' && <NewGroupDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
