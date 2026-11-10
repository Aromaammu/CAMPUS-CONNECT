import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, Input, Modal, SearchInput, useConfirm, useToast } from '@/components/ui';
import { useDebounced } from '@/components/data';
import { get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ConvDetail } from './Thread';

interface Contact { id: string; name: string; detail: string; kind: string }

export function useContacts(q: string, staffOnly = false) {
  const term = useDebounced(q, 250);
  const r = useQuery({ queryKey: ['contacts', term], queryFn: () => get<Contact[]>('/messages/contacts', { q: term }), enabled: term.trim().length >= 2 });
  return { ...r, data: (r.data ?? []).filter((c) => !staffOnly || c.kind !== 'STUDENT'), searching: term.trim().length >= 2 };
}

export function NewChatDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const contacts = useContacts(q);
  const start = useMutation({
    mutationFn: (userId: string) => post<{ id: string }>('/messages/direct', { userId }),
    onSuccess: (c) => { onClose(); navigate(`/messages/${c.id}`); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title="New chat" size="sm">
      <div className="grid gap-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search by name or email" id="new-chat-search" />
        {!contacts.searching ? <p className="text-[13.5px] text-muted">Type at least 2 letters.</p> : contacts.data.length === 0 && !contacts.isLoading ? <p className="text-[13.5px] text-muted">Nobody found that you can message.</p> : (
          <ul className="grid gap-1" aria-label="People">
            {contacts.data.map((c) => (
              <li key={c.id}><button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2" onClick={() => start.mutate(c.id)}>
                <Avatar name={c.name} size={30} /><span className="min-w-0 flex-1"><span className="block font-semibold">{c.name}</span><span className="block text-[12.5px] text-muted">{c.detail}</span></span>
              </button></li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function PeoplePicker({ picked, setPicked }: { picked: Contact[]; setPicked: (f: (p: Contact[]) => Contact[]) => void }) {
  const [q, setQ] = useState('');
  const contacts = useContacts(q, true);
  return (
    <div className="grid gap-2">
      {picked.length > 0 && <div className="flex flex-wrap gap-1.5">{picked.map((p) => (
        <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[13px] font-semibold">
          {p.name}<button type="button" aria-label={`Remove ${p.name}`} onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}</div>}
      <SearchInput value={q} onChange={setQ} placeholder="Add staff by name or email" id="people-picker" />
      {contacts.searching && (
        <ul className="grid max-h-56 gap-1 overflow-y-auto" aria-label="Staff">
          {contacts.data.filter((c) => !picked.some((p) => p.id === c.id)).map((c) => (
            <li key={c.id}><button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2" onClick={() => { setPicked((x) => [...x, c]); setQ(''); }}>
              <UserPlus className="h-4 w-4 text-brand" /><span className="min-w-0 flex-1 truncate">{c.name} <span className="text-[12.5px] text-muted">· {c.detail}</span></span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NewGroupDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<Contact[]>([]);
  const create = useMutation({
    mutationFn: () => post<{ id: string }>('/messages/groups', { title, memberIds: picked.map((p) => p.id) }),
    onSuccess: (c) => { onClose(); navigate(`/messages/${c.id}`); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title="New staff group" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={create.isPending} disabled={title.trim().length < 3 || !picked.length} onClick={() => create.mutate()}>Create group</Button>
    </>}>
      <div className="grid gap-4">
        <Input label="Group name" placeholder="e.g. KOC01 Trainers" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required />
        <PeoplePicker picked={picked} setPicked={setPicked} />
      </div>
    </Modal>
  );
}

export function ConversationInfo({ conv, onClose }: { conv: ConvDetail; onClose: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [adding, setAdding] = useState<Contact[]>([]);
  const change = useMutation({
    mutationFn: (b: { add?: string[]; remove?: string[] }) => post(`/messages/conversations/${conv.id}/members`, { add: b.add ?? [], remove: b.remove ?? [] }),
    onSuccess: () => { setAdding([]); void qc.invalidateQueries({ queryKey: ['conversation', conv.id] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const leave = async () => {
    const c = await confirm({ title: `Leave "${conv.title}"?`, confirmLabel: 'Leave', danger: true });
    if (!c.ok || !user) return;
    await post(`/messages/conversations/${conv.id}/members`, { remove: [user.id] });
    void qc.invalidateQueries({ queryKey: ['conversations'] });
    onClose();
    navigate('/messages');
  };
  const roles: Record<string, string> = { OWNER: 'Owner', ADMIN: conv.kind === 'BATCH' ? 'Teacher' : 'Admin', MEMBER: '' };
  return (
    <Modal open onClose={onClose} title={conv.title} size="sm">
      <div className="grid gap-4">
        <p className="text-[13.5px] text-muted">{conv.kind === 'DIRECT' ? 'Private conversation.' : conv.kind === 'BATCH' ? 'Everyone in this batch: teachers and enrolled students.' : 'Staff group.'} {conv.announcementsOnly && 'Only teachers can post.'}</p>
        <ul className="grid gap-1.5" aria-label="Members">
          {conv.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-[14.5px]">
              <Avatar name={p.name} size={28} />
              <span className="min-w-0 flex-1 truncate">{p.name}{p.id === user?.id ? ' (you)' : ''}</span>
              {roles[p.role] && <Badge dot={false}>{roles[p.role]}</Badge>}
              {conv.kind === 'GROUP' && conv.canManage && p.id !== user?.id && p.role !== 'OWNER' && <Button size="sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => change.mutate({ remove: [p.id] })}><X className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
        {conv.kind === 'GROUP' && conv.canManage && (
          <div className="grid gap-2">
            <h3 className="text-[13px] font-bold uppercase tracking-wide text-muted">Add people</h3>
            <PeoplePicker picked={adding} setPicked={setAdding} />
            {adding.length > 0 && <Button onClick={() => change.mutate({ add: adding.map((a) => a.id) })} loading={change.isPending}>Add {adding.length}</Button>}
          </div>
        )}
        {conv.kind === 'GROUP' && conv.isMember && conv.role !== 'OWNER' && <Button variant="danger" onClick={() => void leave()}>Leave group</Button>}
      </div>
    </Modal>
  );
}

export { PeoplePicker };
export type { Contact };
