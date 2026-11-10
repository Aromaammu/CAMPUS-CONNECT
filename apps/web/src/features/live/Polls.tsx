import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoomContext } from '@livekit/components-react';
import { PollView } from '@cc/shared';
import { BarChart3, Plus, Trash2, X } from 'lucide-react';
import { RoomEvent } from 'livekit-client';
import { FormEvent, useEffect, useState } from 'react';
import { useToast } from '@/components/ui';
import { get, post } from '@/lib/api';

/** Polls for this class, kept fresh from class-room notices. */
export function usePolls(base: string) {
  const room = useRoomContext();
  const qc = useQueryClient();
  const key = ['live-polls', base];
  const q = useQuery({ queryKey: key, queryFn: () => get<PollView[]>(`${base}/polls`) });
  useEffect(() => {
    const onData = (payload: Uint8Array, _p?: unknown, _k?: unknown, topic?: string) => {
      if (topic !== 'notice') return;
      try {
        const n = JSON.parse(new TextDecoder().decode(payload)) as { type: string; pollId?: string; counts?: number[]; voters?: number };
        if (n.type === 'poll') void qc.invalidateQueries({ queryKey: key });
        if (n.type === 'poll-update' && n.pollId) {
          qc.setQueryData<PollView[]>(key, (list) => list?.map((p) => (p.id === n.pollId && (p.counts !== null || p.showResults) ? { ...p, counts: n.counts ?? p.counts, voters: n.voters ?? p.voters } : p)));
        }
      } catch { /* ignore */ }
    };
    room.on(RoomEvent.DataReceived, onData);
    return () => { room.off(RoomEvent.DataReceived, onData); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, base, qc]);
  return q;
}

function Results({ p }: { p: PollView }) {
  if (!p.counts) return null;
  const total = Math.max(1, p.voters ?? 0);
  return (
    <ul className="grid gap-1.5" aria-label={`Results: ${p.question}`}>
      {p.options.map((o, i) => {
        const n = p.counts![i] ?? 0;
        const pct = Math.round((n / total) * 100);
        return (
          <li key={i} className="text-[13.5px]">
            <div className="flex justify-between gap-2"><span className={p.myChoices?.includes(i) ? 'font-bold' : ''}>{o}</span><span className="tabular-nums text-white/70">{n} · {pct}%</span></div>
            <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#C77C12]" style={{ width: `${pct}%` }} /></div>
          </li>
        );
      })}
    </ul>
  );
}

/** Teacher: create polls (or reuse saved ones), watch results, close, share results. */
export function PollsPanel({ base, onClose }: { base: string; onClose: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const polls = usePolls(base);
  const templates = useQuery({ queryKey: ['poll-templates'], queryFn: () => get<{ id: string; question: string; options: string[]; multi: boolean }[]>('/live/poll-templates') });
  const [creating, setCreating] = useState(false);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [showResults, setShowResults] = useState(true);
  const [save, setSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['live-polls', base] });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`${base}/polls`, { question, options: options.filter((o) => o.trim()), multi, showResults, saveTemplate: save });
      toast('Poll sent to the class');
      setCreating(false); setQuestion(''); setOptions(['', '']); setSave(false);
      void refresh();
      if (save) void qc.invalidateQueries({ queryKey: ['poll-templates'] });
    } catch (err) { toast((err as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const act = async (path: string, body?: object) => {
    try { await post(path, body); void refresh(); } catch (err) { toast((err as Error).message, 'bad'); }
  };
  const input = 'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[14px] text-white placeholder:text-white/40 focus:border-[#C77C12] focus:outline-none';

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-[15px] font-bold">Polls</h2>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-white/10" aria-label="Close polls"><X className="h-5 w-5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {creating ? (
          <form onSubmit={submit} className="mb-4 grid gap-2 rounded-lg border border-white/10 p-3" aria-label="New poll">
            {templates.data && templates.data.length > 0 && (
              <select aria-label="Use a saved poll" className={input} value="" onChange={(e) => {
                const t = templates.data!.find((x) => x.id === e.target.value);
                if (t) { setQuestion(t.question); setOptions(t.options); setMulti(t.multi); }
              }}>
                <option value="">Use a saved poll…</option>
                {templates.data.map((t) => <option key={t.id} value={t.id}>{t.question}</option>)}
              </select>
            )}
            <label className="text-[13px] font-semibold" htmlFor="poll-q">Question</label>
            <input id="poll-q" className={input} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} required />
            {options.map((o, i) => (
              <div key={i} className="flex gap-1.5">
                <input aria-label={`Answer ${i + 1}`} className={input} value={o} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? e.target.value : y)))} maxLength={120} placeholder={`Answer ${i + 1}`} />
                {options.length > 2 && <button type="button" className="rounded p-2 hover:bg-white/10" aria-label={`Remove answer ${i + 1}`} onClick={() => setOptions((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>}
              </div>
            ))}
            {options.length < 6 && <button type="button" className="inline-flex items-center gap-1 text-[13.5px] font-semibold text-[#ffcf8a]" onClick={() => setOptions((x) => [...x, ''])}><Plus className="h-4 w-4" />Add an answer</button>}
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} />Students can choose more than one</label>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={showResults} onChange={(e) => setShowResults(e.target.checked)} />Students see the results</label>
            <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />Save this poll to use again</label>
            <div className="mt-1 flex gap-2">
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-[#C77C12] px-3 py-2 text-[14px] font-bold disabled:opacity-50">Send poll</button>
              <button type="button" className="rounded-lg px-3 py-2 text-[14px] hover:bg-white/10" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C77C12] px-3 py-2 text-[14px] font-bold"><Plus className="h-4 w-4" />New poll</button>
        )}
        {polls.isLoading ? <p className="text-[13px] text-white/60">Loading…</p> : !polls.data?.length ? <p className="text-[13.5px] text-white/60">No polls yet. Polls and their results are saved with this class.</p> : (
          <ul className="grid gap-3">
            {polls.data.map((p) => (
              <li key={p.id} className="rounded-lg border border-white/10 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p className="text-[14.5px] font-semibold">{p.question}</p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${p.status === 'OPEN' ? 'bg-[#1f7a4d]' : 'bg-white/15'}`}>{p.status === 'OPEN' ? 'Open' : 'Closed'}</span>
                </div>
                <Results p={p} />
                <p className="mt-1.5 text-[12.5px] text-white/60">{p.voters ?? 0} answered{p.multi ? ' · more than one allowed' : ''}{p.showResults ? ' · students see results' : ' · results hidden from students'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.status === 'OPEN' && <button type="button" className="rounded-lg bg-white/10 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/15" onClick={() => void act(`/live/polls/${p.id}/close`)}>Close poll</button>}
                  <button type="button" className="rounded-lg bg-white/10 px-2.5 py-1 text-[13px] font-semibold hover:bg-white/15" onClick={() => void act(`/live/polls/${p.id}/results`, { showResults: !p.showResults })}>{p.showResults ? 'Hide results' : 'Show results to students'}</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

/** Student: the open poll pops up; after answering, results show if the teacher shares them. */
export function StudentPoll({ base }: { base: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const polls = usePolls(base);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const p = polls.data?.find((x) => x.status === 'OPEN') ?? polls.data?.find((x) => x.showResults && x.counts && x.myChoices);
  useEffect(() => { setPicked(p?.myChoices ?? []); }, [p?.id, p?.myChoices]);
  if (!p || dismissed === p.id) return null;
  const answered = !!p.myChoices;
  const vote = async () => {
    setBusy(true);
    try {
      const v = await post<PollView>(`/live/polls/${p.id}/vote`, { choices: picked });
      qc.setQueryData<PollView[]>(['live-polls', base], (list) => list?.map((x) => (x.id === v.id ? v : x)));
      toast('Answer sent');
    } catch (err) { toast((err as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <section aria-label="Poll" className="absolute bottom-3 right-3 z-20 w-[min(92vw,340px)] rounded-xl bg-[#173640] p-4 shadow-2xl ring-1 ring-white/15">
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-[#ffcf8a]"><BarChart3 className="h-4 w-4" />{p.status === 'OPEN' ? 'Poll' : 'Poll results'}</p>
        <button type="button" onClick={() => setDismissed(p.id)} className="rounded p-0.5 hover:bg-white/10" aria-label="Hide poll"><X className="h-4 w-4" /></button>
      </div>
      <p className="mb-2 text-[15px] font-semibold">{p.question}</p>
      {p.status === 'OPEN' && (
        <fieldset className="grid gap-1.5">
          <legend className="sr-only">{p.multi ? 'Choose one or more' : 'Choose one'}</legend>
          {p.options.map((o, i) => (
            <label key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-[14px] hover:bg-white/10">
              <input type={p.multi ? 'checkbox' : 'radio'} name={`poll-${p.id}`} checked={picked.includes(i)} onChange={(e) => setPicked((x) => (p.multi ? (e.target.checked ? [...x, i] : x.filter((y) => y !== i)) : [i]))} />
              {o}
            </label>
          ))}
          <button type="button" disabled={!picked.length || busy} onClick={() => void vote()} className="mt-1 rounded-lg bg-[#C77C12] px-3 py-2 text-[14px] font-bold disabled:opacity-40">{answered ? 'Change answer' : 'Send answer'}</button>
        </fieldset>
      )}
      {answered && p.counts && <div className="mt-3"><Results p={p} /></div>}
      {answered && !p.counts && <p className="mt-2 text-[13px] text-white/60">Thanks! The teacher will share results if they choose to.</p>}
    </section>
  );
}
