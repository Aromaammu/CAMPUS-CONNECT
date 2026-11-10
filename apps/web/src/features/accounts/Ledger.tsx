import { useMutation, useQueryClient } from '@tanstack/react-query';
import { INSTALMENT_STATE, InstalmentState, PAYMENT_METHODS, formatDate, formatINR, istDateKey, splitInstalments } from '@cc/shared';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { ApiError, download, post } from '@/lib/api';

export interface LedgerView {
  enrolment: { id: string; status: string; enrolledOn: string; student: { id: string; code: string; userId: string; user: { name: string } }; batch: { id: string; name: string; branchId: string; branch: { code: string; name: string }; course: { id: string; name: string } } };
  listPricePaise: number;
  plan: { id: string; totalPaise: number; discountPaise: number; discountReason: string | null; discountStatus: string; netPaise: number } | null;
  instalments: { id: string; seq: number; dueDate: string; amountPaise: number; paidPaise: number; state: InstalmentState }[];
  payments: { id: string; receiptNo: string; kind: string; amountPaise: number; paidOn: string; method: string; reference: string | null; status: string; voidReason: string | null; receivedByName: string | null }[];
  totals: { netPaise: number; paidPaise: number; balancePaise: number; overduePaise: number };
  canRecord?: boolean; canSetPrice?: boolean;
}

export const STATE_TONE: Record<InstalmentState, 'ok' | 'bad' | 'warn' | 'info' | 'neutral'> = { PAID: 'ok', OVERDUE: 'bad', DUE_TODAY: 'warn', DUE_SOON: 'warn', UPCOMING: 'neutral' };
const KIND: Record<string, string> = { PAYMENT: 'Payment', REFUND: 'Refund', ADJUSTMENT: 'Adjustment' };
export const receipt = (id: string) => download(`/accounts/payments/${id}/receipt.pdf`);

/** One enrolment's fees: plan, instalments, payments; actions for accounts staff. */
export function LedgerCard({ l, onChanged, staff }: { l: LedgerView; onChanged: () => void; staff: boolean }) {
  const toast = useToast();
  const [dialog, setDialog] = useState<'plan' | 'pay' | 'other' | null>(null);
  const hasPayments = l.instalments.some((i) => i.paidPaise > 0);
  return (
    <Card title={<span>{l.enrolment.batch.course.name} <span className="font-normal text-muted">· {l.enrolment.batch.name} · {l.enrolment.batch.branch.code}</span></span>}
      actions={staff && l.canRecord && <div className="flex flex-wrap gap-2">
        {!hasPayments && <Button size="sm" variant="secondary" onClick={() => setDialog('plan')}>{l.plan ? 'Change fee plan' : 'Set fee plan'}</Button>}
        {l.plan && l.totals.balancePaise > 0 && <Button size="sm" onClick={() => setDialog('pay')}>Record payment</Button>}
        {l.plan && <Button size="sm" variant="ghost" onClick={() => setDialog('other')}>Refund / adjustment</Button>}
      </div>}>
      {!l.plan ? <p className="text-[14.5px] text-muted">No fee plan yet. Price for this batch: {formatINR(l.listPricePaise)}.</p> : (
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><div className="text-[13px] text-muted">Fee</div><div className="font-bold tabular">{formatINR(l.plan.netPaise)}</div>{l.plan.discountPaise > 0 && <div className="text-[12.5px] text-muted">after {formatINR(l.plan.discountPaise)} off</div>}</div>
            <div><div className="text-[13px] text-muted">Paid</div><div className="font-bold tabular text-ok">{formatINR(l.totals.paidPaise)}</div></div>
            <div><div className="text-[13px] text-muted">Balance</div><div className="font-bold tabular">{formatINR(l.totals.balancePaise)}</div></div>
            <div><div className="text-[13px] text-muted">Overdue</div><div className={`font-bold tabular ${l.totals.overduePaise ? 'text-bad' : ''}`}>{formatINR(l.totals.overduePaise)}</div></div>
          </div>
          {l.plan.discountStatus === 'PENDING' && <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13.5px]">Discount of {formatINR(l.plan.discountPaise)} ({l.plan.discountReason}) is waiting for the Head of Accounts.</p>}
          <div>
            <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Instalments</h3>
            <ul className="divide-y divide-line" aria-label={`Instalments for ${l.enrolment.batch.name}`}>
              {l.instalments.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2 text-[14.5px]">
                  <span className="w-8 text-muted">#{i.seq}</span>
                  <span className="min-w-0 flex-1">Due {formatDate(i.dueDate)}</span>
                  <span className="tabular">{formatINR(i.amountPaise)}{i.paidPaise > 0 && i.paidPaise < i.amountPaise ? ` · ${formatINR(i.paidPaise)} paid` : ''}</span>
                  <Badge tone={STATE_TONE[i.state]}>{INSTALMENT_STATE[i.state]}</Badge>
                </li>
              ))}
            </ul>
          </div>
          {l.payments.length > 0 && (
            <div>
              <h3 className="mb-1 text-[13px] font-bold uppercase tracking-wide text-muted">Payments</h3>
              <ul className="divide-y divide-line" aria-label={`Payments for ${l.enrolment.batch.name}`}>
                {l.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-[14.5px]">
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{p.receiptNo}</span>
                      <span className="block text-[13px] text-muted">{formatDate(p.paidOn)} · {KIND[p.kind]} · {PAYMENT_METHODS[p.method as keyof typeof PAYMENT_METHODS] ?? p.method}{p.reference ? ` · ${p.reference}` : ''}{p.receivedByName ? ` · ${p.receivedByName}` : ''}</span>
                    </span>
                    <span className="tabular font-semibold">{p.kind === 'REFUND' ? '−' : ''}{formatINR(p.amountPaise)}</span>
                    {p.status !== 'VALID' && <Badge tone={p.status === 'VOIDED' ? 'bad' : 'warn'}>{p.status === 'VOIDED' ? 'Voided' : 'Void requested'}</Badge>}
                    <Button size="sm" variant="ghost" aria-label={`Download receipt ${p.receiptNo}`} icon={<Download className="h-4 w-4" />} onClick={() => void receipt(p.id).catch((e) => toast((e as Error).message, 'bad'))} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {dialog === 'plan' && <FeePlanDialog l={l} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'pay' && <PaymentDialog l={l} onClose={() => setDialog(null)} onDone={onChanged} />}
      {dialog === 'other' && <AdjustmentDialog l={l} onClose={() => setDialog(null)} onDone={onChanged} />}
    </Card>
  );
}

const today = () => istDateKey(new Date());

function FeePlanDialog({ l, onClose, onDone }: { l: LedgerView; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [total, setTotal] = useState(String((l.plan?.totalPaise ?? l.listPricePaise) / 100));
  const [dType, setDType] = useState<'AMOUNT' | 'PERCENT'>('AMOUNT');
  const [dValue, setDValue] = useState('0');
  const [reason, setReason] = useState('');
  const [count, setCount] = useState('3');
  const [first, setFirst] = useState(today());
  const totalPaise = Math.round((Number(total) || 0) * 100);
  const discount = dType === 'PERCENT' ? Math.round((totalPaise * (Number(dValue) || 0)) / 100) : Math.round((Number(dValue) || 0) * 100);
  const net = Math.max(0, totalPaise - discount);
  const generated = useMemo(() => splitInstalments(net, Number(count) || 1, first), [net, count, first]);
  const [rows, setRows] = useState<{ dueDate: string; amount: string }[] | null>(null);
  const list = rows ?? generated.map((g) => ({ dueDate: g.dueDate, amount: String(g.amountPaise / 100) }));
  const sum = list.reduce((a, r) => a + Math.round((Number(r.amount) || 0) * 100), 0);
  const save = useMutation({
    mutationFn: () => post('/accounts/fee-plans', { enrolmentId: l.enrolment.id, totalFee: Number(total), discountType: dType, discountValue: Number(dValue) || 0, discountReason: reason || undefined, instalments: list.map((r) => ({ dueDate: r.dueDate, amount: Number(r.amount) })) }),
    onSuccess: (p: unknown) => { toast((p as { discountStatus: string }).discountStatus === 'PENDING' ? 'Fee plan saved. The discount waits for the Head of Accounts.' : 'Fee plan saved'); onDone(); onClose(); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title={`Fee plan: ${l.enrolment.student.user.name}`} size="lg" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={save.isPending} disabled={sum !== net || !list.length} onClick={() => save.mutate()}>Save fee plan</Button>
    </>}>
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Input label="Course fee (₹)" type="number" value={total} onChange={(e) => { setTotal(e.target.value); setRows(null); }} disabled={!l.canSetPrice} help={l.canSetPrice ? undefined : 'Batch price'} />
          <Select label="Discount" value={dType} onChange={(e) => { setDType(e.target.value as 'AMOUNT' | 'PERCENT'); setRows(null); }} options={[{ value: 'AMOUNT', label: 'Amount (₹)' }, { value: 'PERCENT', label: 'Percent (%)' }]} />
          <Input label={dType === 'PERCENT' ? 'Discount %' : 'Discount ₹'} type="number" value={dValue} onChange={(e) => { setDValue(e.target.value); setRows(null); }} />
        </div>
        {discount > 0 && <Input label="Reason for the discount" value={reason} onChange={(e) => setReason(e.target.value)} required help="Discounts above the limit (10%) need the Head of Accounts' approval." />}
        <p className="text-[14.5px]">Fee after discount: <b className="tabular">{formatINR(net)}</b></p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Instalments" value={count} onChange={(e) => { setCount(e.target.value); setRows(null); }} options={['1', '2', '3', '4', '6', '10', '12'].map((v) => ({ value: v, label: v === '1' ? 'One-time payment' : `${v} monthly` }))} />
          <Input label="First due date" type="date" value={first} onChange={(e) => { setFirst(e.target.value); setRows(null); }} />
        </div>
        <ul className="grid gap-2" aria-label="Instalment plan">
          {list.map((r, i) => (
            <li key={i} className="flex items-end gap-2">
              <span className="w-8 pb-2 text-muted">#{i + 1}</span>
              <Input className="flex-1" label="Due date" type="date" value={r.dueDate} onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
              <Input className="flex-1" label="Amount (₹)" type="number" value={r.amount} onChange={(e) => setRows(list.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
              {list.length > 1 && <Button variant="ghost" aria-label={`Remove instalment ${i + 1}`} icon={<Trash2 className="h-4 w-4" />} onClick={() => setRows(list.filter((_, j) => j !== i))} />}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setRows([...list, { dueDate: list[list.length - 1]?.dueDate ?? first, amount: '0' }])}>Add instalment</Button>
          <span className={`text-[14px] ${sum === net ? 'text-ok' : 'text-bad'}`}>Instalments add up to {formatINR(sum)}{sum !== net ? ` (should be ${formatINR(net)})` : ''}</span>
        </div>
      </div>
    </Modal>
  );
}

function PaymentDialog({ l, onClose, onDone }: { l: LedgerView; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const next = l.instalments.find((i) => i.paidPaise < i.amountPaise);
  const [amount, setAmount] = useState(String(next ? (next.amountPaise - next.paidPaise) / 100 : l.totals.balancePaise / 100));
  const [paidOn, setPaidOn] = useState(today());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => post<{ id: string; receiptNo: string }>('/accounts/payments', { enrolmentId: l.enrolment.id, amount: Number(amount), paidOn, method, reference: reference || undefined, note: note || undefined }),
    onSuccess: (p) => { toast(`Payment recorded. Receipt ${p.receiptNo}`); onDone(); onClose(); void receipt(p.id).catch(() => undefined); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); },
  });
  return (
    <Modal open onClose={onClose} title={`Record payment: ${l.enrolment.student.user.name}`} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={save.isPending} onClick={() => save.mutate()}>Record payment</Button>
    </>}>
      <div className="grid gap-4">
        <p className="text-[14px] text-muted">Balance {formatINR(l.totals.balancePaise)}. The payment goes to the oldest unpaid instalment first.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} error={errors.amount} required />
          <Input label="Date" type="date" value={paidOn} max={today()} onChange={(e) => setPaidOn(e.target.value)} error={errors.paidOn} required />
          <Select label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))} />
          <Input label="Reference number" value={reference} onChange={(e) => setReference(e.target.value)} error={errors.reference} required={method !== 'CASH'} help={method === 'CASH' ? 'Not needed for cash' : 'UPI / bank / cheque / card slip number'} />
        </div>
        <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2} />
      </div>
    </Modal>
  );
}

function AdjustmentDialog({ l, onClose, onDone }: { l: LedgerView; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'REFUND' | 'ADJUSTMENT'>('REFUND');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => post<{ receiptNo: string }>('/accounts/adjustments', { enrolmentId: l.enrolment.id, kind, amount: Number(amount), paidOn: today(), method, note }),
    onSuccess: (p) => { toast(`${kind === 'REFUND' ? 'Refund' : 'Adjustment'} recorded (${p.receiptNo})`); onDone(); onClose(); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  return (
    <Modal open onClose={onClose} title="Refund or adjustment" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={save.isPending} disabled={!Number(amount) || note.trim().length < 3} onClick={() => save.mutate()}>Record</Button>
    </>}>
      <div className="grid gap-4">
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as 'REFUND' | 'ADJUSTMENT')} options={[{ value: 'REFUND', label: 'Refund (money returned to the student)' }, { value: 'ADJUSTMENT', label: 'Adjustment (reduce what is due)' }]} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Amount (₹)" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          {kind === 'REFUND' && <Select label="Paid back by" value={method} onChange={(e) => setMethod(e.target.value)} options={Object.entries(PAYMENT_METHODS).map(([value, label]) => ({ value, label }))} />}
        </div>
        <Textarea label="Reason" value={note} onChange={(e) => setNote(e.target.value)} required rows={2} maxLength={300} />
        <p className="text-[13px] text-muted">Payments are never edited. To cancel a wrong payment, ask for a void from Receipts.</p>
      </div>
    </Modal>
  );
}

/** For the student detail page and the student's own payments page. */
export function useLedgerRefresh(key: unknown[]) {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: key });
}
