import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { branchSchema, formatDate } from '@cc/shared';
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Badge, Button, Card, Empty, ErrorBox, Input, Modal, PageHeader, SearchInput, Spinner, useToast } from '@/components/ui';
import { useDebounced } from '@/components/data';
import { ApiError, get, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export interface BranchRow {
  id: string; code: string; name: string; city: string | null; state: string | null; status: 'ACTIVE' | 'INACTIVE'; openedOn: string | null;
  branchAdmins: string[]; _count: { students: number; employees: number; batches: number };
}

export function BranchesPage() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ['branches', dq], queryFn: () => get<BranchRow[]>('/branches', { q: dq }) });
  return (
    <>
      <PageHeader
        title="Branches"
        subtitle={can('branches.create') ? 'Every franchise branch in the network' : 'Your branch'}
        actions={can('branches.create') && <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add branch</Button>}
      />
      <SearchInput className="mb-4 max-w-sm" value={q} onChange={setQ} placeholder="Search by name, code or city" />
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.length ? (
        <Card><Empty title="No branches found" icon={<Building2 className="h-8 w-8" />} /></Card>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Code</th><th>Branch</th><th>Branch Admin</th><th className="text-right">Students</th><th className="text-right">Staff</th><th className="text-right">Batches</th><th>Status</th></tr></thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id}>
                  <td className="font-mono text-[13px]"><Link className="font-semibold text-brand hover:underline" to={`/branches/${b.id}`}>{b.code}</Link></td>
                  <td><Link to={`/branches/${b.id}`} className="font-semibold hover:underline">{b.name}</Link><span className="block text-[12.5px] text-muted">{[b.city, b.state].filter(Boolean).join(', ')}{b.openedOn ? ` · since ${formatDate(b.openedOn)}` : ''}</span></td>
                  <td>{b.branchAdmins.length ? b.branchAdmins.join(', ') : <span className="text-muted">Not assigned</span>}</td>
                  <td className="text-right tabular">{b._count.students}</td>
                  <td className="text-right tabular">{b._count.employees}</td>
                  <td className="text-right tabular">{b._count.batches}</td>
                  <td><Badge tone={b.status === 'ACTIVE' ? 'ok' : 'neutral'}>{b.status === 'ACTIVE' ? 'Active' : 'Closed'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <BranchFormModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

type BranchForm = z.input<typeof branchSchema>;

export function BranchFields({ f, editing }: { f: ReturnType<typeof useForm<BranchForm>>; editing?: boolean }) {
  const e = f.formState.errors;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Branch code" required disabled={editing} help={editing ? 'The code cannot change' : 'e.g. KOC02: used in student IDs and receipt numbers'} {...f.register('code')} error={e.code?.message} />
      <Input label="Branch name" required {...f.register('name')} error={e.name?.message} />
      <Input label="Address" className="sm:col-span-2" {...f.register('address')} error={e.address?.message} />
      <Input label="City" {...f.register('city')} error={e.city?.message} />
      <Input label="State" {...f.register('state')} error={e.state?.message} />
      <Input label="PIN code" inputMode="numeric" {...f.register('pin')} error={e.pin?.message} />
      <Input label="Phone" inputMode="tel" {...f.register('phone')} error={e.phone?.message} />
      <Input label="Email" type="email" {...f.register('email')} error={e.email?.message} />
      <Input label="GSTIN (optional)" {...f.register('gstin')} error={e.gstin?.message} />
      <Input label="Opening date" type="date" {...f.register('openedOn')} error={e.openedOn?.message} />
    </div>
  );
}

export function applyServerErrors(e: unknown, setError: (k: never, v: { message: string }) => void, toast: (m: string, t?: 'bad') => void) {
  if (e instanceof ApiError && Object.keys(e.fieldErrors).length) Object.entries(e.fieldErrors).forEach(([k, m]) => setError(k as never, { message: m }));
  else toast((e as Error).message, 'bad');
}

function BranchFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const nav = useNavigate();
  const qc = useQueryClient();
  const f = useForm<BranchForm>({ resolver: zodResolver(branchSchema) });
  const m = useMutation({
    mutationFn: (v: BranchForm) => post<{ id: string; code: string }>('/branches', v),
    onSuccess: (b) => { toast(`Branch ${b.code} added`); qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['branch-options'] }); f.reset(); onClose(); nav(`/branches/${b.id}`); },
    onError: (e) => applyServerErrors(e, f.setError as never, toast),
  });
  return (
    <Modal open={open} onClose={onClose} title="Add a branch" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={f.handleSubmit((v) => m.mutate(v))}>Add branch</Button></>}>
      <p className="mb-4 text-[14px] text-muted">The new branch starts with the head-office departments and designations. You can add its Branch Admin next.</p>
      <BranchFields f={f} />
    </Modal>
  );
}
