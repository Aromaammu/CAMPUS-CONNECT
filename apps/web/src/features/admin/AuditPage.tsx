import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { formatDateTime } from '@cc/shared';
import { ChevronDown, ScrollText } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Card, Empty, ErrorBox, Input, PageHeader, Pagination, SearchInput, Select, Spinner } from '@/components/ui';
import { BranchSelect, FilterBar, Paged, useDebounced } from '@/components/data';
import { get } from '@/lib/api';

interface Row { id: string; createdAt: string; action: string; entity: string; summary: string | null; actor: { name: string } | null; branchCode: string | null; ip: string | null; before: unknown; after: unknown }

export function AuditPage() {
  const [q, setQ] = useState('');
  const [branchId, setBranchId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const dq = useDebounced(q);
  const actions = useQuery({ queryKey: ['audit-actions'], queryFn: () => get<string[]>('/audit/actions') });
  const list = useQuery({
    queryKey: ['audit', dq, branchId, action, from, to, page],
    queryFn: () => get<Paged<Row>>('/audit', { q: dq, branchId, action, from, to, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  const prefixes = [...new Set((actions.data ?? []).map((a) => a.split('.')[0]))];
  return (
    <>
      <PageHeader title="Audit log" subtitle="Every important action, kept permanently. Entries can never be changed or deleted." />
      <FilterBar className="lg:grid-cols-5">
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search what happened or who" className="self-end" />
        <BranchSelect allowAll value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />
        <Select label="Area" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} placeholder="Everything" options={prefixes.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
        <Input label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </FilterBar>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} /> : !list.data?.rows.length ? <Card><Empty title="Nothing recorded for these filters" icon={<ScrollText className="h-8 w-8" />} /></Card> : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Who</th><th>What happened</th><th>Branch</th><th /></tr></thead>
              <tbody>
                {list.data.rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr>
                      <td className="whitespace-nowrap tabular text-[13.5px]">{formatDateTime(r.createdAt)}</td>
                      <td>{r.actor?.name ?? 'System'}</td>
                      <td>{r.summary ?? r.action}<span className="block font-mono text-[12px] text-muted">{r.action}</span></td>
                      <td>{r.branchCode ?? '—'}</td>
                      <td className="text-right">{(r.before != null || r.after != null) && (
                        <button type="button" className="rounded p-1 text-muted hover:bg-surface-2" aria-expanded={open === r.id} aria-label="Show details" onClick={() => setOpen(open === r.id ? null : r.id)}>
                          <ChevronDown className={`h-4 w-4 transition-transform ${open === r.id ? 'rotate-180' : ''}`} />
                        </button>
                      )}</td>
                    </tr>
                    {open === r.id && (
                      <tr><td colSpan={5} className="bg-surface-2/60">
                        <div className="grid gap-3 md:grid-cols-2">
                          {r.before != null && <div><p className="text-[12px] font-bold uppercase text-muted">Before</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px]">{JSON.stringify(r.before, null, 2)}</pre></div>}
                          {r.after != null && <div><p className="text-[12px] font-bold uppercase text-muted">After</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px]">{JSON.stringify(r.after, null, 2)}</pre></div>}
                        </div>
                      </td></tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={50} total={list.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}
