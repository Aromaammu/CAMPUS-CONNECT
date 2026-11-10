import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ANNOUNCEMENT_AUDIENCE, formatDate, formatDateTime } from '@cc/shared';
import clsx from 'clsx';
import { CalendarPlus, Megaphone, ShieldCheck, Video } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, ButtonLink, Card, Checkbox, Empty, ErrorBox, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Tabs, Textarea, useToast } from '@/components/ui';
import { Paged, useBranchOptions, useDebounced } from '@/components/data';
import { ApiError, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Contact, PeoplePicker } from './dialogs';
import { Thread } from './Thread';

// ── Announcements ──

interface InboxRow { id: string; title: string; body: string; author: string; createdAt: string; read: boolean }

/** Everyone: announcements that reach me. */
export function AnnouncementsInboxPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ['announcements-inbox', page], queryFn: () => get<Paged<InboxRow> & { unread: number }>('/announcements/mine', { page }) });
  const read = (id: string) => void post(`/announcements/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ['announcements-inbox'] })).catch(() => undefined);
  return (
    <>
      <PageHeader title="Announcements" subtitle="Notices from head office and your branch." />
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data.rows.length ? <Card><Empty title="No announcements yet" icon={<Megaphone className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-3">
          {q.data.rows.map((a) => (
            <Card key={a.id} className={clsx(!a.read && 'border-accent/60')}>
              <article aria-label={a.title}>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[16.5px] font-bold">{a.title}</h2>
                  {!a.read && <Badge tone="warn">New</Badge>}
                </div>
                <p className="text-[13px] text-muted">{a.author} · {formatDateTime(a.createdAt)}</p>
                <p className="mt-2 whitespace-pre-wrap text-[14.5px]">{a.body}</p>
                {!a.read && <Button className="mt-2" size="sm" variant="secondary" onClick={() => read(a.id)}>Mark as read</Button>}
              </article>
            </Card>
          ))}
          <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </div>
      )}
    </>
  );
}

interface SentRow { id: string; title: string; body: string; author: string; createdAt: string; scope: string; audience: keyof typeof ANNOUNCEMENT_AUDIENCE; reads: number; reach: number; target: string }

/** AD13: send announcements and see who read them. */
export function AnnouncementsPage() {
  const [composing, setComposing] = useState(false);
  const q = useQuery({ queryKey: ['announcements-sent'], queryFn: () => get<SentRow[]>('/announcements/sent') });
  return (
    <>
      <PageHeader title="Send announcements" subtitle="Read-only notices to branches or batches, with read counts." actions={<Button icon={<Megaphone className="h-4 w-4" />} onClick={() => setComposing(true)}>New announcement</Button>} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title="Nothing sent yet" icon={<Megaphone className="h-8 w-8" />} /></Card> : (
        <Card padded={false}>
          <ul className="divide-y divide-line" aria-label="Sent announcements">
            {q.data.map((a) => (
              <li key={a.id} className="flex flex-col gap-1 px-4 py-3 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-[13px] text-muted">{a.target} · {ANNOUNCEMENT_AUDIENCE[a.audience]} · {a.author} · {formatDate(a.createdAt)}</div>
                </div>
                <div className="text-[14px]"><b className="tabular">{a.reads}</b> of <span className="tabular">{a.reach}</span> read</div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {composing && <ComposeAnnouncement onClose={() => setComposing(false)} />}
    </>
  );
}

function ComposeAnnouncement({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const headOffice = user?.branchIds === null;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scope, setScope] = useState<'ALL' | 'BRANCHES' | 'BATCHES'>(headOffice ? 'ALL' : 'BRANCHES');
  const [audience, setAudience] = useState<'EVERYONE' | 'STAFF' | 'STUDENTS'>('EVERYONE');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [batchIds, setBatchIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const branches = useBranchOptions('announcements.send');
  const batches = useQuery({ queryKey: ['announce-batches'], queryFn: () => get<Paged<{ id: string; name: string; branch: { code: string } }>>('/batches', { pageSize: 200 }), enabled: scope === 'BATCHES' });
  const send = useMutation({
    mutationFn: () => post<{ recipients: number }>('/announcements', { title, body, scope, audience, branchIds, batchIds }),
    onSuccess: (r) => { toast(`Sent to ${r.recipients} people`); void qc.invalidateQueries({ queryKey: ['announcements-sent'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); },
  });
  const toggle = (list: string[], set: (v: string[]) => void, id: string, on: boolean) => set(on ? [...list, id] : list.filter((x) => x !== id));
  return (
    <Modal open onClose={onClose} title="New announcement" size="lg" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={send.isPending} onClick={() => send.mutate()}>Send announcement</Button>
    </>}>
      <div className="grid gap-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} maxLength={150} required />
        <Textarea label="Message" value={body} onChange={(e) => setBody(e.target.value)} error={errors.body} rows={5} maxLength={5000} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Send to" value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} options={[...(headOffice ? [{ value: 'ALL', label: 'Every branch' }] : []), { value: 'BRANCHES', label: 'Chosen branches' }, { value: 'BATCHES', label: 'Chosen batches' }]} />
          <Select label="Who" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)} options={Object.entries(ANNOUNCEMENT_AUDIENCE).map(([value, label]) => ({ value, label }))} />
        </div>
        {scope === 'BRANCHES' && (
          <fieldset><legend className="mb-1 text-[14px] font-semibold">Branches</legend>
            <div className="grid gap-1.5 sm:grid-cols-2">{(branches.data ?? []).map((b) => <Checkbox key={b.id} label={`${b.code} · ${b.name}`} checked={branchIds.includes(b.id)} onChange={(e) => toggle(branchIds, setBranchIds, b.id, e.target.checked)} />)}</div>
            {errors.branchIds && <p className="mt-1 text-[13px] text-bad">{errors.branchIds}</p>}
          </fieldset>
        )}
        {scope === 'BATCHES' && (
          <fieldset><legend className="mb-1 text-[14px] font-semibold">Batches</legend>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto sm:grid-cols-2">{(batches.data?.rows ?? []).map((b) => <Checkbox key={b.id} label={`${b.branch.code} · ${b.name}`} checked={batchIds.includes(b.id)} onChange={(e) => toggle(batchIds, setBatchIds, b.id, e.target.checked)} />)}</div>
            {errors.batchIds && <p className="mt-1 text-[13px] text-bad">{errors.batchIds}</p>}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

// ── Moderation (AD14) ──

export function ModerationPage() {
  const { id } = useParams();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 300);
  const list = useQuery({ queryKey: ['moderation', term], queryFn: () => get<{ id: string; kind: string; title: string; members: number; lastMessageAt: string | null; hidden: number }[]>('/messages/moderation/conversations', { q: term }) });
  if (id) return <div className="-my-6 h-[calc(100dvh-57px)] border-x border-line bg-surface"><Thread id={id} mode="moderation" backTo="/moderation" /></div>;
  return (
    <>
      <PageHeader title="Chat moderation" subtitle="Review conversations that include students and hide messages that break the rules. Every action is recorded." />
      <SearchInput className="mb-4 max-w-sm" value={q} onChange={setQ} placeholder="Search by person or group" />
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.length ? <Card><Empty title="No conversations to review" icon={<ShieldCheck className="h-8 w-8" />} /></Card> : (
        <Card padded={false}>
          <ul className="divide-y divide-line" aria-label="Conversations to review">
            {list.data.map((c) => (
              <li key={c.id}><Link to={`/moderation/${c.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface-2">
                <span className="min-w-0 flex-1"><span className="block font-semibold">{c.title}</span><span className="block text-[13px] text-muted">{c.kind === 'BATCH' ? 'Batch group' : 'Private chat'} · {c.members} people{c.lastMessageAt ? ` · last message ${formatDateTime(c.lastMessageAt)}` : ''}</span></span>
                {c.hidden > 0 && <Badge tone="bad">{c.hidden} hidden</Badge>}
              </Link></li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ── Staff meetings (C6) ──

interface MeetingRow { id: string; title: string; host: string; isHost: boolean; scheduledAt: string | null; durationMin: number; status: string; startedAt: string | null; endedAt: string | null; invited: number; fromChat: boolean; createdAt: string }

export function MeetingsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['meetings', tab], queryFn: () => get<MeetingRow[]>('/meetings', { when: tab }), refetchInterval: 30_000 });
  const cancel = useMutation({ mutationFn: (id: string) => post(`/meetings/${id}/cancel`), onSuccess: () => { toast('Meeting cancelled. Invited people were told.'); void qc.invalidateQueries({ queryKey: ['meetings'] }); }, onError: (e) => toast((e as Error).message, 'bad') });
  return (
    <>
      <PageHeader title="Staff meetings" subtitle="Meet colleagues in our own meeting room: video, screen share, chat, polls and whiteboard."
        actions={user?.permissions.includes('meetings.host') && <Button icon={<CalendarPlus className="h-4 w-4" />} onClick={() => setCreating(true)}>New meeting</Button>} />
      <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: 'upcoming', label: 'Upcoming' }, { id: 'past', label: 'Past' }]} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title={tab === 'upcoming' ? 'No meetings planned' : 'No past meetings'} icon={<Video className="h-8 w-8" />} /></Card> : (
        <Card padded={false}>
          <ul className="divide-y divide-line" aria-label="Meetings">
            {q.data.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{m.title}</div>
                  <div className="text-[13px] text-muted">{m.scheduledAt ? formatDateTime(m.scheduledAt) : `Started ${formatDateTime(m.startedAt ?? m.createdAt)}`} · {m.durationMin} min · host {m.isHost ? 'you' : m.host} · {m.fromChat ? 'call from a chat' : `${m.invited} people`}</div>
                </div>
                {m.status === 'LIVE' && <Badge tone="bad">Live now</Badge>}
                {m.status === 'CANCELLED' && <Badge>Cancelled</Badge>}
                {tab === 'upcoming' && <ButtonLink to={`/meet/${m.id}`} size="sm" variant={m.status === 'LIVE' ? 'accent' : 'primary'} icon={<Video className="h-4 w-4" />}>{m.isHost && m.status !== 'LIVE' ? 'Start' : 'Join'}</ButtonLink>}
                {tab === 'upcoming' && m.isHost && m.status === 'SCHEDULED' && m.scheduledAt && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(m.id)}>Cancel</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {creating && <NewMeeting onClose={() => setCreating(false)} />}
    </>
  );
}

function NewMeeting({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [people, setPeople] = useState<Contact[]>([]);
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/meetings', {
      title, durationMin: Number(duration), participantIds: people.map((p) => p.id),
      ...(when === 'later' && date && time ? { scheduledAt: new Date(`${date}T${time}:00+05:30`).toISOString() } : {}),
    }),
    onSuccess: (m) => { void qc.invalidateQueries({ queryKey: ['meetings'] }); onClose(); if (when === 'now') navigate(`/meet/${m.id}`); else toast('Meeting planned. Invitations sent.'); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title="New meeting" size="lg" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={create.isPending} disabled={title.trim().length < 3 || !people.length || (when === 'later' && (!date || !time))} onClick={() => create.mutate()}>{when === 'now' ? 'Start now' : 'Plan meeting'}</Button>
    </>}>
      <div className="grid gap-4">
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} required />
        <Tabs value={when} onChange={setWhen} tabs={[{ id: 'now', label: 'Start now' }, { id: 'later', label: 'Plan for later' }]} />
        {when === 'later' && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            <Input label="Time" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
            <Select label="Length" value={duration} onChange={(e) => setDuration(e.target.value)} options={['15', '30', '45', '60', '90', '120'].map((v) => ({ value: v, label: `${v} min` }))} />
          </div>
        )}
        <div><h3 className="mb-1 text-[14px] font-semibold">Invite</h3><PeoplePicker picked={people} setPicked={setPeople} /></div>
      </div>
    </Modal>
  );
}
