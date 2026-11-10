import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Button, SearchInput, useToast } from '@/components/ui';
import { useDebounced } from '@/components/data';
import { del, get, post } from '@/lib/api';
import type { PeopleResult } from './types';

/** Teacher / Branch Admin invites guests (guest trainer, observer from head office) to one class. */
export function GuestManager({ sessionId, dark = false }: { sessionId: string; dark?: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const term = useDebounced(q, 250);
  const people = useQuery({ queryKey: ['live-people', sessionId], queryFn: () => get<PeopleResult>(`/live/sessions/${sessionId}/people`) });
  const cands = useQuery({
    queryKey: ['live-guest-cands', sessionId, term],
    queryFn: () => get<{ id: string; name: string; detail: string }[]>(`/live/sessions/${sessionId}/guest-candidates`, { q: term }),
    enabled: term.trim().length >= 2,
  });
  const add = useMutation({
    mutationFn: (userId: string) => post(`/live/sessions/${sessionId}/guests`, { userId }),
    onSuccess: () => { setQ(''); toast('Guest added. They can now join this class.'); qc.invalidateQueries({ queryKey: ['live-people', sessionId] }); },
    onError: (e: Error) => toast(e.message, 'bad'),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => del(`/live/sessions/${sessionId}/guests/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['live-people', sessionId] }),
  });
  const guests = people.data?.guests ?? [];
  const already = new Set(guests.map((g) => g.userId));
  const muted = dark ? 'text-white/60' : 'text-muted';
  return (
    <div className="grid gap-2">
      <h3 className="text-[14.5px] font-bold">Guests for this class</h3>
      <p className={`text-[13px] ${muted}`}>Invite a guest trainer or someone from head office. Only invited people, enrolled students and the teachers can join.</p>
      {guests.length > 0 && (
        <ul className="grid gap-1.5">
          {guests.map((g) => (
            <li key={g.userId} className="flex items-center gap-2 text-[14px]">
              <Avatar name={g.name} size={26} />
              <span className="min-w-0 flex-1 truncate">{g.name} <span className={muted}>· {g.detail}</span></span>
              <Button size="sm" variant="ghost" aria-label={`Remove guest ${g.name}`} onClick={() => remove.mutate(g.userId)}><X className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}
      <SearchInput value={q} onChange={setQ} placeholder="Search staff by name or email" id={`guest-search-${sessionId}`} />
      {term.trim().length >= 2 && cands.data && (
        cands.data.length === 0 ? <p className={`text-[13px] ${muted}`}>No staff found.</p> : (
          <ul className="grid gap-1">
            {cands.data.filter((c) => !already.has(c.id)).map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-[14px]">
                <span className="min-w-0 flex-1 truncate">{c.name} <span className={muted}>· {c.detail}</span></span>
                <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" />} loading={add.isPending && add.variables === c.id} onClick={() => add.mutate(c.id)} aria-label={`Invite ${c.name}`}>Invite</Button>
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
