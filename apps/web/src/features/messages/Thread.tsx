import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { formatDate, formatTime, istDateKey } from '@cc/shared';
import clsx from 'clsx';
import { ArrowLeft, CornerUpLeft, Eye, EyeOff, Info, Megaphone, Paperclip, Pencil, Phone, Send, Trash2, X } from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Button, ErrorBox, Spinner, useConfirm, useToast } from '@/components/ui';
import { del, get, patch, post, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { emitRealtime, useRealtime } from '@/lib/realtime';
import { ConversationInfo } from './dialogs';

export interface ConvSummary {
  id: string; kind: 'DIRECT' | 'BATCH' | 'GROUP'; title: string; subtitle: string | null; otherUserId: string | null; announcementsOnly: boolean; unread: number;
  role: string | null; members: number; lastMessageAt: string | null; canPost: boolean;
  last: { text: string; sender: string; mine: boolean; createdAt: string } | null;
}
export interface ConvDetail extends ConvSummary {
  moderator: boolean; isMember: boolean; canManage: boolean;
  people: { id: string; name: string; kind: string; role: string; lastReadAt: string | null }[];
}
export interface MessageView {
  id: string; conversationId: string; sender: { id: string; name: string; kind: string }; createdAt: string; editedAt: string | null;
  text: string | null; file: { id: string; name: string; mime: string; sizeBytes: number } | null; deleted: boolean; hidden: boolean; hiddenReason: string | null;
  replyTo: { id: string; sender: string; text: string | null } | null;
}
type Page = { messages: MessageView[]; more: boolean };

const EDIT_MINUTES = 15;

export async function openMessageFile(id: string) {
  const { url } = await get<{ url: string }>(`/messages/${id}/file`);
  window.open(url, '_blank', 'noopener');
}

/** One conversation: messages, composer, live updates. In moderation mode it is read-only with hide/show. */
export function Thread({ id, mode = 'chat', backTo }: { id: string; mode?: 'chat' | 'moderation'; backTo: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<MessageView | null>(null);
  const [editing, setEditing] = useState<MessageView | null>(null);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(null);
  const [info, setInfo] = useState(false);
  const lastTyping = useRef(0);
  const stick = useRef(true);

  const conv = useQuery({ queryKey: ['conversation', id], queryFn: () => get<ConvDetail>(`/messages/conversations/${id}`) });
  const msgs = useInfiniteQuery({
    queryKey: ['messages', id],
    queryFn: ({ pageParam }) => get<Page>(`/messages/conversations/${id}/messages`, { before: pageParam || undefined }),
    initialPageParam: '',
    getNextPageParam: (last) => (last.more ? last.messages[0]?.createdAt : undefined),
  });
  const all = (msgs.data?.pages ?? []).slice().reverse().flatMap((p) => p.messages);
  const markRead = () => { if (mode === 'chat' && conv.data?.isMember) void post(`/messages/conversations/${id}/read`).then(() => { void qc.invalidateQueries({ queryKey: ['conversations'] }); void qc.invalidateQueries({ queryKey: ['messages-unread'] }); }).catch(() => undefined); };
  // Opening a conversation marks it read (once per conversation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (conv.data?.isMember) markRead(); }, [id, conv.data?.isMember]);

  const upsert = (m: MessageView) => qc.setQueryData<InfiniteData<Page>>(['messages', id], (d) => {
    if (!d) return d;
    const exists = d.pages.some((p) => p.messages.some((x) => x.id === m.id));
    if (exists) return { ...d, pages: d.pages.map((p) => ({ ...p, messages: p.messages.map((x) => (x.id === m.id ? m : x)) })) };
    const [first, ...rest] = d.pages;
    return { ...d, pages: [{ ...first, messages: [...first.messages, m] }, ...rest] };
  });
  useRealtime<MessageView>('message', (m) => {
    if (m.conversationId !== id) return;
    upsert(m);
    if (m.sender.id !== user?.id) { setTyping(null); if (document.visibilityState === 'visible') markRead(); }
  });
  useRealtime<MessageView>('message-updated', (m) => { if (m.conversationId === id) upsert(m); });
  useRealtime<{ conversationId: string; name: string }>('typing', (t) => { if (t.conversationId === id) setTyping({ name: t.name, until: Date.now() + 3500 }); });
  useRealtime<{ conversationId: string }>('read', (r) => { if (r.conversationId === id) void qc.invalidateQueries({ queryKey: ['conversation', id] }); });
  useRealtime<{ id: string }>('conversation', (c) => { if (c.id === id) void qc.invalidateQueries({ queryKey: ['conversation', id] }); });
  useEffect(() => {
    if (!typing) return;
    const t = setTimeout(() => setTyping(null), Math.max(0, typing.until - Date.now()));
    return () => clearTimeout(t);
  }, [typing]);

  // Keep the newest message in view unless the reader scrolled up.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [all.length, id]);

  const send = useMutation({
    mutationFn: async () => {
      if (editing) return patch<MessageView>(`/messages/${editing.id}`, { text });
      return post<MessageView>(`/messages/conversations/${id}/messages`, { text: text || undefined, fileId: file?.id, replyToId: replyTo?.id });
    },
    onSuccess: (m) => { upsert(m); setText(''); setReplyTo(null); setEditing(null); setFile(null); stick.current = true; void qc.invalidateQueries({ queryKey: ['conversations'] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const submit = (e?: FormEvent) => { e?.preventDefault(); if ((text.trim() || file) && !send.isPending) send.mutate(); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { setReplyTo(null); setEditing(null); }
  };
  const onType = (v: string) => {
    setText(v);
    if (Date.now() - lastTyping.current > 2000) { lastTyping.current = Date.now(); emitRealtime('typing', { conversationId: id }); }
  };
  const attach = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try { const fd = new FormData(); fd.append('file', f); setFile(await upload<{ id: string; name: string }>('/messages/upload', fd)); }
    catch (e) { toast((e as Error).message, 'bad'); } finally { setUploading(false); }
  };
  const remove = async (m: MessageView) => {
    const c = await confirm({ title: 'Delete this message?', body: 'Everyone in the conversation will see that it was deleted.', confirmLabel: 'Delete', danger: true });
    if (!c.ok) return;
    try { upsert(await del<MessageView>(`/messages/${m.id}`)); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const moderate = async (m: MessageView) => {
    if (m.hidden) { try { upsert(await post<MessageView>(`/messages/${m.id}/unhide`)); toast('Message shown again'); } catch (e) { toast((e as Error).message, 'bad'); } return; }
    const c = await confirm({ title: 'Hide this message?', body: 'Members will see that a moderator hid it. This is recorded in the audit log.', confirmLabel: 'Hide', danger: true, requireReason: true, reasonLabel: 'Reason' });
    if (!c.ok) return;
    try { upsert(await post<MessageView>(`/messages/${m.id}/hide`, { reason: c.reason })); toast('Message hidden'); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const call = useMutation({
    mutationFn: () => post<{ id: string }>('/meetings', { title: `Call: ${conv.data?.title ?? 'chat'}`, conversationId: id }),
    onSuccess: (m) => navigate(`/meet/${m.id}`),
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const toggleAnnouncements = async () => {
    try { await patch(`/messages/conversations/${id}`, { announcementsOnly: !conv.data?.announcementsOnly }); void conv.refetch(); toast(conv.data?.announcementsOnly ? 'Everyone can post again' : 'Only teachers can post now'); }
    catch (e) { toast((e as Error).message, 'bad'); }
  };

  if (conv.isLoading) return <Spinner />;
  if (conv.error || !conv.data) return <div className="p-4"><ErrorBox error={conv.error} /></div>;
  const c = conv.data;
  const others = c.people.filter((p) => p.id !== user?.id);
  const lastMine = [...all].reverse().find((m) => m.sender.id === user?.id && !m.deleted);
  const seenByAll = lastMine && others.length > 0 && others.every((p) => p.lastReadAt && new Date(p.lastReadAt) >= new Date(lastMine.createdAt));
  const seenCount = lastMine ? others.filter((p) => p.lastReadAt && new Date(p.lastReadAt) >= new Date(lastMine.createdAt)).length : 0;
  let lastDay = '';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
        <Link to={backTo} className="rounded p-1 hover:bg-surface-2 md:hidden" aria-label="Back to conversations"><ArrowLeft className="h-5 w-5" /></Link>
        <Avatar name={c.title} size={34} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15.5px] font-bold">{c.title}</h2>
          <p className="truncate text-[12.5px] text-muted">{typing ? `${typing.name} is typing…` : c.subtitle}</p>
        </div>
        {mode === 'chat' && c.isMember && user?.permissions.includes('meetings.host') && (
          <Button size="sm" variant="secondary" icon={<Phone className="h-4 w-4" />} loading={call.isPending} onClick={() => call.mutate()}>Call</Button>
        )}
        {mode === 'chat' && c.kind === 'BATCH' && c.canManage && (
          <Button size="sm" variant="ghost" icon={<Megaphone className="h-4 w-4" />} onClick={() => void toggleAnnouncements()} aria-pressed={c.announcementsOnly}>
            <span className="hidden sm:inline">{c.announcementsOnly ? 'Let everyone post' : 'Teachers only'}</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label="Conversation details" icon={<Info className="h-4 w-4" />} onClick={() => setInfo(true)} />
      </header>

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} role="log" aria-label="Messages" aria-live="polite">
        {msgs.hasNextPage && <div className="mb-3 text-center"><Button size="sm" variant="ghost" loading={msgs.isFetchingNextPage} onClick={() => { stick.current = false; void msgs.fetchNextPage(); }}>Show earlier messages</Button></div>}
        {msgs.isLoading ? <Spinner /> : !all.length ? <p className="py-10 text-center text-[14px] text-muted">No messages yet. Say hello!</p> : all.map((m) => {
          const mine = m.sender.id === user?.id;
          const day = istDateKey(m.createdAt);
          const showDay = day !== lastDay;
          lastDay = day;
          const recent = Date.now() - new Date(m.createdAt).getTime() < EDIT_MINUTES * 60_000;
          return (
            <div key={m.id}>
              {showDay && <div className="my-3 text-center text-[12px] font-semibold text-muted">{formatDate(m.createdAt)}</div>}
              <div className={clsx('group mb-2 flex gap-2', mine ? 'justify-end' : 'justify-start')} data-message={m.id}>
                {!mine && c.kind !== 'DIRECT' && <Avatar name={m.sender.name} size={28} className="mt-5" />}
                <div className={clsx('max-w-[78%]', mine && 'items-end text-right')}>
                  {!mine && c.kind !== 'DIRECT' && <div className="mb-0.5 text-[12px] font-semibold text-muted">{m.sender.name}{m.sender.kind !== 'STUDENT' && c.kind === 'BATCH' ? ' · staff' : ''}</div>}
                  <div className={clsx('inline-block rounded-2xl px-3 py-2 text-left text-[14.5px]', mine ? 'bg-brand text-brand-fg' : 'bg-surface-2', (m.deleted || (m.hidden && !m.text)) && 'italic opacity-70')}>
                    {m.replyTo && (
                      <div className={clsx('mb-1 rounded-lg border-l-4 px-2 py-1 text-[12.5px]', mine ? 'border-white/60 bg-white/10' : 'border-brand/50 bg-surface')}>
                        <b>{m.replyTo.sender}</b>: {m.replyTo.text ?? 'Message removed'}
                      </div>
                    )}
                    {m.deleted ? 'This message was deleted' : m.hidden && !m.text ? 'Hidden by a moderator' : (
                      <>
                        {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                        {m.file && <button type="button" onClick={() => void openMessageFile(m.id).catch((err) => toast((err as Error).message, 'bad'))} className={clsx('mt-1 inline-flex items-center gap-1.5 font-semibold underline', mine ? 'text-brand-fg' : 'text-brand')}><Paperclip className="h-4 w-4" />{m.file.name}</button>}
                      </>
                    )}
                    {m.hidden && m.text && <div className="mt-1 text-[12px] font-semibold text-bad">Hidden: {m.hiddenReason}</div>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted" style={{ justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                    <span>{formatTime(m.createdAt)}{m.editedAt && !m.deleted ? ' · edited' : ''}</span>
                    {mode === 'chat' && !m.deleted && !m.hidden && c.canPost && <button type="button" className="rounded p-0.5 opacity-60 hover:bg-surface-2 hover:opacity-100" aria-label="Reply" onClick={() => { setReplyTo(m); setEditing(null); }}><CornerUpLeft className="h-3.5 w-3.5" /></button>}
                    {mode === 'chat' && mine && !m.deleted && recent && m.text && <button type="button" className="rounded p-0.5 opacity-60 hover:bg-surface-2 hover:opacity-100" aria-label="Edit message" onClick={() => { setEditing(m); setReplyTo(null); setText(m.text ?? ''); }}><Pencil className="h-3.5 w-3.5" /></button>}
                    {mode === 'chat' && mine && !m.deleted && recent && <button type="button" className="rounded p-0.5 opacity-60 hover:bg-surface-2 hover:opacity-100" aria-label="Delete message" onClick={() => void remove(m)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    {c.moderator && !mine && !m.deleted && <button type="button" className="rounded px-1 font-semibold text-bad hover:bg-bad-soft" aria-label={m.hidden ? 'Show message again' : 'Hide message'} onClick={() => void moderate(m)}>{m.hidden ? <Eye className="inline h-3.5 w-3.5" /> : <EyeOff className="inline h-3.5 w-3.5" />} {m.hidden ? 'Show' : 'Hide'}</button>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {lastMine && seenCount > 0 && <p className="text-right text-[11.5px] text-muted" aria-live="polite">{c.kind === 'DIRECT' || seenByAll ? 'Seen' : `Seen by ${seenCount}`}</p>}
      </div>

      {mode === 'chat' && (c.canPost ? (
        <form onSubmit={submit} className="border-t border-line p-2" style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
          {(replyTo || editing || file) && (
            <div className="mb-1.5 flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{editing ? 'Editing your message' : replyTo ? <>Replying to <b>{replyTo.sender.name}</b>: {replyTo.text ?? 'File'}</> : <>Attached: <b>{file!.name}</b></>}</span>
              <button type="button" className="rounded p-0.5 hover:bg-surface" aria-label="Cancel" onClick={() => { setReplyTo(null); setEditing(null); setFile(null); if (editing) setText(''); }}><X className="h-4 w-4" /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            {!editing && (
              <label className="cursor-pointer rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Attach a file">
                <Paperclip className="h-5 w-5" />
                <input type="file" className="sr-only" onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            )}
            <label htmlFor={`compose-${id}`} className="sr-only">Message</label>
            <textarea id={`compose-${id}`} value={text} onChange={(e) => onType(e.target.value)} onKeyDown={onKey} rows={1} maxLength={4000}
              placeholder={uploading ? 'Uploading…' : 'Write a message'} className="input max-h-40 min-h-[42px] flex-1 resize-none py-2" />
            <Button type="submit" aria-label={editing ? 'Save message' : 'Send message'} disabled={(!text.trim() && !file) || uploading} loading={send.isPending} icon={<Send className="h-4 w-4" />} />
          </div>
        </form>
      ) : (
        <p className="border-t border-line px-4 py-3 text-center text-[13.5px] text-muted">{c.isMember ? 'Only teachers can post in this group.' : 'You are reading this conversation as a moderator.'}</p>
      ))}
      {info && <ConversationInfo conv={c} onClose={() => setInfo(false)} />}
    </div>
  );
}
