import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { INSTALMENT_STATE, InstalmentState, PAYMENT_METHODS, formatDate, formatDateTime, formatINR, istDateKey } from '@cc/shared';
import { Bell, Download, FileSpreadsheet, Lock, Unlock, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, ButtonLink, Card, Checkbox, Empty, ErrorBox, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, Stat, Tabs, useConfirm, useToast } from '@/components/ui';
import { BranchSelect, Paged, useDebounced } from '@/components/data';
import { download, get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LedgerCard, LedgerView, STATE_TONE, receipt } from './Ledger';

const todayKey = () => istDateKey(new Date());
const daysAgo = (n: number) => new Date(new Date(`${todayKey()}T00:00:00Z`).getTime() - n * 86400_000).toISOString().slice(0, 10);

interface Summary {
  from: string; to: string; salesPaise: number; collectionsPaise: number; refundsPaise: number; adjustmentsPaise: number; discountsPaise: number; pendingPaise: number; overduePaise: number;
  byMethod: { key: string; label: string; amountPaise: number }[]; byBranch: { key: string; label: string; amountPaise: number }[];
  byCourse: { key: string; label: string; amountPaise: number }[]; byBatch: { key: string; label: string; amountPaise: number }[];
  daily: { date: string; amountPaise: number }[];
}

function Filters({ branchId, setBranchId, from, setFrom, to, setTo }: { branchId: string; setBranchId: (v: string) => void; from: string; setFrom: (v: string) => void; to: string; setTo: (v: string) => void }) {
  return (
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <div className="w-60 max-w-full"><BranchSelect perm="accounts.view" allowAll value={branchId} onChange={setBranchId} /></div>
      <Input className="w-40" label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
      <Input className="w-40" label="To" type="date" value={to} max={todayKey()} onChange={(e) => setTo(e.target.value)} />
    </div>
  );
}

/** Daily collections: one series, so no legend; the title names it; hover shows the exact amount. */
function DailyBars({ data }: { data: Summary['daily'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.amountPaise));
  const H = 140;
  return (
    <figure className="relative" aria-label="Daily collections chart">
      <div className="flex h-[140px] items-end gap-[2px] border-b border-line" role="img" aria-label={`Daily collections from ${formatDate(data[0]?.date ?? todayKey())} to ${formatDate(data[data.length - 1]?.date ?? todayKey())}`}>
        {data.map((d, i) => (
          <div key={d.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${formatDate(d.date)}: ${formatINR(d.amountPaise)}`}>
            <div className="w-full rounded-t-[4px] bg-brand transition-opacity" style={{ height: d.amountPaise ? Math.max(3, (d.amountPaise / max) * H) : 0, opacity: hover === null || hover === i ? 1 : 0.45 }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[12px] text-muted"><span>{data[0] && formatDate(data[0].date)}</span><span>{data[data.length - 1] && formatDate(data[data.length - 1].date)}</span></div>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute -top-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] shadow-lg" style={{ left: `min(calc(${(hover / data.length) * 100}% ), calc(100% - 140px))` }}>
          <div className="text-muted">{formatDate(data[hover].date)}</div><div className="font-bold tabular">{formatINR(data[hover].amountPaise)}</div>
        </div>
      )}
    </figure>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { key: string; label: string; amountPaise: number }[] }) {
  const total = rows.reduce((a, r) => a + r.amountPaise, 0) || 1;
  return (
    <Card title={title} padded={false}>
      {!rows.length ? <p className="p-4 text-[14px] text-muted">No collections in this period.</p> : (
        <table className="w-full text-[14px]">
          <tbody>{rows.map((r) => (
            <tr key={r.key} className="border-t border-line first:border-t-0">
              <td className="px-4 py-2">{r.label}</td>
              <td className="px-4 py-2 text-right tabular font-semibold">{formatINR(r.amountPaise)}</td>
              <td className="w-16 px-4 py-2 text-right tabular text-muted">{Math.round((r.amountPaise / total) * 100)}%</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Card>
  );
}

function useSummary() {
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(todayKey());
  const q = useQuery({ queryKey: ['accounts-summary', branchId, from, to], queryFn: () => get<Summary>('/accounts/summary', { branchId, from, to }) });
  return { q, filters: { branchId, setBranchId, from, setFrom, to, setTo } };
}

/** AC1 Accounts dashboard. */
export function AccountsDashboard() {
  const { user } = useAuth();
  const { q, filters } = useSummary();
  const approvals = useQuery({ queryKey: ['accounts-approvals'], queryFn: () => get<{ voids: unknown[]; discounts: unknown[] }>('/accounts/approvals'), enabled: !!user?.permissions.includes('accounts.approve') });
  const waiting = (approvals.data?.voids.length ?? 0) + (approvals.data?.discounts.length ?? 0);
  return (
    <>
      <PageHeader title="Accounts" subtitle="Sales, collections and dues. Payments are recorded on each student's page."
        actions={<div className="flex flex-wrap gap-2"><ButtonLink to="/accounts/dues" size="sm">Dues</ButtonLink><ButtonLink to="/accounts/receipts" size="sm">Receipts</ButtonLink><ButtonLink to="/accounts/day-close" size="sm">Day close</ButtonLink></div>} />
      <Filters {...filters} />
      {waiting > 0 && <Link to="/accounts/approvals" className="mb-4 block rounded-lg bg-warn-soft px-4 py-3 text-[14.5px] font-semibold">{waiting} item{waiting > 1 ? 's' : ''} waiting for your approval →</Link>}
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Collections" value={formatINR(q.data.collectionsPaise)} sub={`${formatDate(q.data.from)} – ${formatDate(q.data.to)}`} />
            <Stat label="Sales (new fee plans)" value={formatINR(q.data.salesPaise)} />
            <Link to="/accounts/dues?status=overdue"><Stat label="Overdue now" value={formatINR(q.data.overduePaise)} tone={q.data.overduePaise ? 'bad' : undefined} /></Link>
            <Link to="/accounts/dues?status=soon"><Stat label="Pending (not yet due)" value={formatINR(q.data.pendingPaise)} /></Link>
            <Stat label="Discounts given" value={formatINR(q.data.discountsPaise)} />
            <Stat label="Refunds" value={formatINR(q.data.refundsPaise)} />
            <Stat label="Adjustments" value={formatINR(q.data.adjustmentsPaise)} />
          </div>
          <Card title="Daily collections"><DailyBars data={q.data.daily} /></Card>
          <div className="grid gap-5 lg:grid-cols-2">
            <Breakdown title="By payment method" rows={q.data.byMethod} />
            <Breakdown title="By branch" rows={q.data.byBranch} />
          </div>
        </div>
      )}
    </>
  );
}

/** AC7 Collections & sales reports with Excel export. */
export function AccountsReportsPage() {
  const toast = useToast();
  const { q, filters } = useSummary();
  const exp = (type: string) => void download('/accounts/export.xlsx', { type, branchId: filters.branchId, from: filters.from, to: filters.to }).catch((e) => toast((e as Error).message, 'bad'));
  return (
    <>
      <PageHeader title="Collections & sales" subtitle="By branch, course, batch and payment method. Export to Excel."
        actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exp('receipts')}>Export receipts</Button><Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={() => exp('dues')}>Export dues</Button></div>} />
      <Filters {...filters} />
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="grid gap-5 lg:grid-cols-2">
          <Breakdown title="By branch" rows={q.data.byBranch} />
          <Breakdown title="By payment method" rows={q.data.byMethod} />
          <Breakdown title="By course" rows={q.data.byCourse} />
          <Breakdown title="By batch" rows={q.data.byBatch} />
        </div>
      )}
    </>
  );
}

interface DueRow { id: string; seq: number; dueDate: string; duePaise: number; state: InstalmentState; lastReminderAt: string | null; student: { id: string; code: string; user: { name: string; mobile: string | null } }; batch: string; branch: string }

/** AC6 Dues & reminders. */
export function DuesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const initial = new URLSearchParams(window.location.search).get('status') ?? 'overdue';
  const [status, setStatus] = useState(initial);
  const [branchId, setBranchId] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const [picked, setPicked] = useState<string[]>([]);
  const q = useQuery({ queryKey: ['dues', status, branchId, term], queryFn: () => get<{ rows: DueRow[]; totalPaise: number }>('/accounts/dues', { status, branchId, q: term }) });
  const remind = useMutation({
    mutationFn: (ids: string[]) => post<{ sent: number }>('/accounts/dues/remind', { instalmentIds: ids }),
    onSuccess: (r) => { toast(`${r.sent} reminder${r.sent === 1 ? '' : 's'} sent by email and SMS`); setPicked([]); void qc.invalidateQueries({ queryKey: ['dues'] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const rows = q.data?.rows ?? [];
  return (
    <>
      <PageHeader title="Dues & reminders" subtitle="Automatic reminders go 3 days before, on the due date, then weekly while overdue."
        actions={picked.length > 0 && <Button icon={<Bell className="h-4 w-4" />} loading={remind.isPending} onClick={() => remind.mutate(picked)}>Remind {picked.length}</Button>} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs value={status} onChange={(v) => { setStatus(v); setPicked([]); }} tabs={[{ id: 'overdue', label: 'Overdue' }, { id: 'today', label: 'Due today' }, { id: 'soon', label: 'Due soon' }, { id: 'all', label: 'All unpaid' }]} />
        <div className="w-56 max-w-full"><BranchSelect perm="accounts.view" allowAll value={branchId} onChange={setBranchId} /></div>
        <SearchInput className="w-60 max-w-full" value={search} onChange={setSearch} placeholder="Student name or ID" />
      </div>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !rows.length ? <Card><Empty title="Nothing due here" icon={<Wallet className="h-8 w-8" />} /></Card> : (
        <Card padded={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-[14px]">
            <Checkbox label="Select all" checked={picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((r) => r.id) : [])} />
            <span>Total <b className="tabular">{formatINR(q.data!.totalPaise)}</b></span>
          </div>
          <ul className="divide-y divide-line" aria-label="Dues">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <input type="checkbox" className="h-4 w-4" aria-label={`Select ${r.student.user.name}`} checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} />
                <Link to={`/students/${r.student.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="block font-semibold">{r.student.user.name} <span className="font-normal text-muted">{r.student.code}</span></span>
                  <span className="block text-[13px] text-muted">{r.branch} · {r.batch} · instalment {r.seq} due {formatDate(r.dueDate)}{r.lastReminderAt ? ` · reminded ${formatDateTime(r.lastReminderAt)}` : ''}</span>
                </Link>
                <span className="tabular font-semibold">{formatINR(r.duePaise)}</span>
                <Badge tone={STATE_TONE[r.state]}>{INSTALMENT_STATE[r.state]}</Badge>
                <Button size="sm" variant="ghost" aria-label={`Remind ${r.student.user.name}`} icon={<Bell className="h-4 w-4" />} onClick={() => remind.mutate([r.id])} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

interface ReceiptRow { id: string; receiptNo: string; kind: string; status: string; amountPaise: number; paidOn: string; method: string; reference: string | null; voidReason: string | null; canRequestVoid: boolean; student: { id: string; code: string; user: { name: string } }; branch: { code: string }; enrolment: { batch: { name: string } } }

/** AC5 Receipts with void requests. */
export function ReceiptsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [branchId, setBranchId] = useState('');
  const [method, setMethod] = useState('');
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 300);
  const q = useQuery({ queryKey: ['receipts', page, branchId, method, term], queryFn: () => get<Paged<ReceiptRow>>('/accounts/receipts', { page, branchId, method, q: term }) });
  const askVoid = async (r: ReceiptRow) => {
    const c = await confirm({ title: `Ask to void ${r.receiptNo}?`, body: 'Payments are never edited. The Head of Accounts will approve or reject the void.', confirmLabel: 'Ask to void', danger: true, requireReason: true, reasonLabel: 'Why should it be voided?' });
    if (!c.ok) return;
    try { await post(`/accounts/payments/${r.id}/void`, { reason: c.reason }); toast('Void requested'); void qc.invalidateQueries({ queryKey: ['receipts'] }); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <>
      <PageHeader title="Receipts" subtitle="Every payment, refund and adjustment, with its receipt." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56 max-w-full"><BranchSelect perm="accounts.view" allowAll value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} /></div>
        <Select className="w-44" label="Method" value={method} onChange={(e) => { setMethod(e.target.value); setPage(1); }} placeholder="All methods" options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))} />
        <SearchInput className="w-64 max-w-full" value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Receipt no., student or reference" />
      </div>
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data.rows.length ? <Card><Empty title="No receipts found" /></Card> : (
        <>
          <Card padded={false}>
            <ul className="divide-y divide-line" aria-label="Receipts">
              {q.data.rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{r.receiptNo} <span className="font-normal text-muted">· {formatDate(r.paidOn)}</span></div>
                    <div className="text-[13px] text-muted"><Link className="hover:underline" to={`/students/${r.student.id}`}>{r.student.user.name}</Link> · {r.branch.code} · {r.enrolment.batch.name} · {PAYMENT_METHODS[r.method as keyof typeof PAYMENT_METHODS] ?? r.method}{r.reference ? ` · ${r.reference}` : ''}{r.kind !== 'PAYMENT' ? ` · ${r.kind === 'REFUND' ? 'Refund' : 'Adjustment'}` : ''}</div>
                    {r.voidReason && <div className="text-[13px] text-bad">Void reason: {r.voidReason}</div>}
                  </div>
                  <span className="tabular font-semibold">{r.kind === 'REFUND' ? '−' : ''}{formatINR(r.amountPaise)}</span>
                  {r.status !== 'VALID' && <Badge tone={r.status === 'VOIDED' ? 'bad' : 'warn'}>{r.status === 'VOIDED' ? 'Voided' : 'Void requested'}</Badge>}
                  <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => void receipt(r.id).catch((e) => toast((e as Error).message, 'bad'))}>PDF</Button>
                  {r.canRequestVoid && <Button size="sm" variant="ghost" className="text-bad" onClick={() => void askVoid(r)}>Void</Button>}
                </li>
              ))}
            </ul>
          </Card>
          <Pagination page={page} pageSize={q.data.pageSize} total={q.data.total} onPage={setPage} />
        </>
      )}
    </>
  );
}

interface Approvals {
  voids: { id: string; receiptNo: string; amountPaise: number; paidOn: string; method: string; reason: string | null; requestedBy: string; student: { code: string; user: { name: string } }; branch: string }[];
  discounts: { id: string; totalPaise: number; discountPaise: number; reason: string | null; requestedBy: string; student: { code: string; user: { name: string } }; batch: string; branch: string }[];
}

/** AC8 Approvals for the Head of Accounts. */
export function ApprovalsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['accounts-approvals'], queryFn: () => get<Approvals>('/accounts/approvals') });
  const decide = async (path: string, approve: boolean, what: string) => {
    let note: string | undefined;
    if (!approve) {
      const c = await confirm({ title: `Reject this ${what}?`, confirmLabel: 'Reject', danger: true, requireReason: true });
      if (!c.ok) return;
      note = c.reason;
    }
    try { await post(path, { approve, note }); toast(approve ? 'Approved' : 'Rejected'); void qc.invalidateQueries({ queryKey: ['accounts-approvals'] }); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <>
      <PageHeader title="Approvals" subtitle="Voids and large discounts need your decision. Every decision is in the audit log." />
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="grid gap-5">
          <Card title={`Voids (${q.data.voids.length})`} padded={false}>
            {!q.data.voids.length ? <p className="p-4 text-[14px] text-muted">No voids waiting.</p> : (
              <ul className="divide-y divide-line" aria-label="Voids waiting">
                {q.data.voids.map((v) => (
                  <li key={v.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{v.receiptNo} · {formatINR(v.amountPaise)}</div>
                      <div className="text-[13px] text-muted">{v.student.user.name} ({v.student.code}) · {v.branch} · paid {formatDate(v.paidOn)} · asked by {v.requestedBy}</div>
                      <div className="text-[14px]">Reason: {v.reason}</div>
                    </div>
                    <div className="flex gap-2"><Button size="sm" onClick={() => void decide(`/accounts/payments/${v.id}/void-decision`, true, 'void')}>Approve void</Button><Button size="sm" variant="secondary" onClick={() => void decide(`/accounts/payments/${v.id}/void-decision`, false, 'void')}>Keep payment</Button></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={`Discounts (${q.data.discounts.length})`} padded={false}>
            {!q.data.discounts.length ? <p className="p-4 text-[14px] text-muted">No discounts waiting.</p> : (
              <ul className="divide-y divide-line" aria-label="Discounts waiting">
                {q.data.discounts.map((d) => (
                  <li key={d.id} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{formatINR(d.discountPaise)} off {formatINR(d.totalPaise)} ({Math.round((d.discountPaise / d.totalPaise) * 100)}%)</div>
                      <div className="text-[13px] text-muted">{d.student.user.name} ({d.student.code}) · {d.branch} · {d.batch} · asked by {d.requestedBy}</div>
                      <div className="text-[14px]">Reason: {d.reason}</div>
                    </div>
                    <div className="flex gap-2"><Button size="sm" onClick={() => void decide(`/accounts/fee-plans/${d.id}/discount-decision`, true, 'discount')}>Approve</Button><Button size="sm" variant="secondary" onClick={() => void decide(`/accounts/fee-plans/${d.id}/discount-decision`, false, 'discount')}>Reject</Button></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

interface DayClose { date: string; byPerson: { name: string; branch: string; cashPaise: number; otherPaise: number; refundsPaise: number; count: number }[]; totals: { cashPaise: number; otherPaise: number; refundsPaise: number }; payments: { id: string; receiptNo: string; kind: string; status: string; amountPaise: number; method: string; student: { code: string; user: { name: string } }; receivedBy: string | null }[] }

/** AC9 Day-close: cash by accountant. */
export function DayClosePage() {
  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(todayKey());
  const q = useQuery({ queryKey: ['day-close', branchId, date], queryFn: () => get<DayClose>('/accounts/day-close', { branchId, date }) });
  return (
    <>
      <PageHeader title="Day close" subtitle="One day's collections, with cash held by each person." />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-56 max-w-full"><BranchSelect perm="accounts.view" allowAll value={branchId} onChange={setBranchId} /></div>
        <Input className="w-44" label="Date" type="date" value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
      </div>
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="grid gap-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Cash" value={formatINR(q.data.totals.cashPaise)} />
            <Stat label="UPI, bank, card, cheque" value={formatINR(q.data.totals.otherPaise)} />
            <Stat label="Refunds paid" value={formatINR(q.data.totals.refundsPaise)} />
          </div>
          <Card title="By person" padded={false}>
            {!q.data.byPerson.length ? <p className="p-4 text-[14px] text-muted">No payments on {formatDate(q.data.date)}.</p> : (
              <table className="w-full text-[14px]">
                <thead><tr className="text-left text-[12.5px] text-muted"><th className="px-4 py-2 font-semibold">Person</th><th className="px-4 py-2 text-right font-semibold">Cash</th><th className="px-4 py-2 text-right font-semibold">Other</th><th className="hidden px-4 py-2 text-right font-semibold sm:table-cell">Refunds</th></tr></thead>
                <tbody>{q.data.byPerson.map((p, i) => (
                  <tr key={i} className="border-t border-line"><td className="px-4 py-2">{p.name} <span className="text-muted">· {p.branch} · {p.count}</span></td><td className="px-4 py-2 text-right tabular font-semibold">{formatINR(p.cashPaise)}</td><td className="px-4 py-2 text-right tabular">{formatINR(p.otherPaise)}</td><td className="hidden px-4 py-2 text-right tabular sm:table-cell">{formatINR(p.refundsPaise)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </Card>
        </div>
      )}
    </>
  );
}

interface Fees { canLock: boolean; courses: { id: string; code: string; name: string; defaultFeePaise: number; feeLocked: boolean }[]; batches: { id: string; name: string; feePaise: number | null; canSetPrice: boolean; branch: { code: string }; course: { name: string; defaultFeePaise: number; feeLocked: boolean } }[] }

/** AC2 Course and branch fees. */
export function FeesPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['fees'], queryFn: () => get<Fees>('/accounts/fees') });
  const [editing, setEditing] = useState<{ kind: 'course' | 'batch'; id: string; name: string; value: string } | null>(null);
  const save = useMutation({
    mutationFn: () => editing!.kind === 'course' ? put(`/accounts/fees/courses/${editing!.id}`, { defaultFee: Number(editing!.value) }) : put(`/accounts/fees/batches/${editing!.id}`, { fee: editing!.value === '' ? null : Number(editing!.value) }),
    onSuccess: () => { toast('Price saved'); setEditing(null); void qc.invalidateQueries({ queryKey: ['fees'] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  const lock = useMutation({
    mutationFn: (c: { id: string; feeLocked: boolean }) => put(`/accounts/fees/courses/${c.id}`, { feeLocked: !c.feeLocked }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['fees'] }),
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <>
      <PageHeader title="Course & branch fees" subtitle="Head office sets each course's fee; branches may set a price per batch unless the course is locked." />
      {q.isLoading ? <Spinner /> : q.error || !q.data ? <ErrorBox error={q.error} retry={q.refetch} /> : (
        <div className="grid gap-5">
          <Card title="Course fees" padded={false}>
            <ul className="divide-y divide-line" aria-label="Course fees">
              {q.data.courses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 font-semibold">{c.name} <span className="font-normal text-muted">{c.code}</span></span>
                  <span className="tabular font-semibold">{formatINR(c.defaultFeePaise)}</span>
                  {c.feeLocked && <Badge tone="warn">Locked</Badge>}
                  {q.data!.canLock && <>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'course', id: c.id, name: c.name, value: String(c.defaultFeePaise / 100) })}>Change</Button>
                    <Button size="sm" variant="ghost" icon={c.feeLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />} onClick={() => lock.mutate(c)}>{c.feeLocked ? 'Unlock' : 'Lock'}</Button>
                  </>}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Batch prices" padded={false}>
            <ul className="divide-y divide-line" aria-label="Batch prices">
              {q.data.batches.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1"><span className="block font-semibold">{b.branch.code} · {b.name}</span><span className="block text-[13px] text-muted">{b.course.name}</span></span>
                  <span className="tabular font-semibold">{formatINR(b.feePaise ?? b.course.defaultFeePaise)}</span>
                  {b.feePaise === null && <Badge dot={false}>Course fee</Badge>}
                  {b.canSetPrice && <Button size="sm" variant="ghost" onClick={() => setEditing({ kind: 'batch', id: b.id, name: b.name, value: b.feePaise === null ? '' : String(b.feePaise / 100) })}>Set price</Button>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`Price: ${editing.name}`} size="sm" footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
          <Input label="Fee (₹)" type="number" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} help={editing.kind === 'batch' ? 'Leave empty to use the course fee' : undefined} />
        </Modal>
      )}
    </>
  );
}

/** AC3 on the student page: fees per enrolment (accounts staff). */
export function StudentFeesSection({ studentId }: { studentId: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['student-fees', studentId], queryFn: () => get<LedgerView[]>(`/accounts/students/${studentId}`), retry: false });
  if (q.isLoading) return <Spinner />;
  if (q.error) return null; // not accounts staff
  return (
    <div className="mt-5 grid gap-4">
      <h2 className="text-[18px] font-bold">Fees</h2>
      {!q.data?.length ? <Card><Empty title="No enrolments" /></Card> : q.data.map((l) => <LedgerCard key={l.enrolment.id} l={l} staff onChanged={() => void qc.invalidateQueries({ queryKey: ['student-fees', studentId] })} />)}
    </div>
  );
}

/** S7 Payments & dues (student). */
export function StudentPaymentsPage() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['my-fees'], queryFn: () => get<LedgerView[]>('/me/fees') });
  const dl = (kind: string) => void download(`/reports/students/me/${kind}.pdf`).catch((e) => toast((e as Error).message, 'bad'));
  return (
    <>
      <PageHeader title="Payments & dues" subtitle="Your fees, what you have paid and what is due. Pay at your branch; receipts appear here."
        actions={<div className="flex flex-wrap gap-2"><Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => dl('payments')}>Payment statement</Button><Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => dl('dues')}>Dues statement</Button></div>} />
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} retry={q.refetch} /> : !q.data?.length ? <Card><Empty title="No fees yet" icon={<Wallet className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-5">{q.data.map((l) => <LedgerCard key={l.enrolment.id} l={l} staff={false} onChanged={() => undefined} />)}</div>
      )}
    </>
  );
}

