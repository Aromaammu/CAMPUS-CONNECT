import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { branchSchema, formatDate, formatWeekdayDate, roomSchema } from '@cc/shared';
import { Plus, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import { Badge, Button, Card, DefinitionList, Empty, ErrorBox, Input, Modal, PageHeader, Spinner, Stat, Tabs, useConfirm, useToast } from '@/components/ui';
import { del, get, patch, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BranchFields, applyServerErrors } from './BranchesPage';
import { EmployeeFormModal } from '../people/EmployeeForm';

interface Room { id: string; name: string; capacity: number; active: boolean }
interface Holiday { id: string; date: string; name: string; branchId: string | null }
interface BranchDetail {
  id: string; code: string; name: string; address: string | null; city: string | null; state: string | null; pin: string | null; phone: string | null; email: string | null; gstin: string | null;
  openedOn: string | null; status: 'ACTIVE' | 'INACTIVE'; rooms: Room[]; holidays: Holiday[]; _count: { students: number; employees: number; batches: number };
  branchAdmins: { id: string; code: string; user: { name: string; email: string | null; mobile: string | null; status: string } }[];
}
type Tab = 'details' | 'rooms' | 'holidays';

export function BranchDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('details');
  const [editing, setEditing] = useState(false);
  const [addAdmin, setAddAdmin] = useState(false);
  const q = useQuery({ queryKey: ['branch', id], queryFn: () => get<BranchDetail>(`/branches/${id}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['branch', id] }); qc.invalidateQueries({ queryKey: ['branches'] }); };
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const b = q.data;
  const manage = can('branch.manage', id);
  const toggle = async () => {
    const closing = b.status === 'ACTIVE';
    const r = await confirm({ title: closing ? `Close ${b.code}?` : `Reopen ${b.code}?`, body: closing ? 'Its history stays available read-only. It will no longer appear in branch lists for new work.' : 'The branch becomes active again.', confirmLabel: closing ? 'Close branch' : 'Reopen', danger: closing });
    if (!r.ok) return;
    await patch(`/branches/${id}/status`, { status: closing ? 'INACTIVE' : 'ACTIVE' });
    toast(closing ? 'Branch closed' : 'Branch reopened');
    refresh();
  };
  return (
    <>
      <PageHeader
        back={{ to: '/branches', label: 'Branches' }}
        title={<span className="flex flex-wrap items-center gap-3">{b.name}<Badge tone={b.status === 'ACTIVE' ? 'ok' : 'neutral'}>{b.status === 'ACTIVE' ? 'Active' : 'Closed'}</Badge></span>}
        subtitle={<span className="font-mono">{b.code}</span>}
        actions={<>
          {manage && <Button variant="secondary" onClick={() => setEditing(true)}>Edit details</Button>}
          {can('branches.create') && <Button variant={b.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={toggle}>{b.status === 'ACTIVE' ? 'Close branch' : 'Reopen branch'}</Button>}
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Students" value={b._count.students} />
        <Stat label="Staff" value={b._count.employees} />
        <Stat label="Batches" value={b._count.batches} />
        <Stat label="Rooms" value={b.rooms.filter((r) => r.active).length} />
      </div>
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'details', label: 'Details' }, { id: 'rooms', label: 'Rooms', count: b.rooms.length }, { id: 'holidays', label: 'Holidays', count: b.holidays.length }]} />
      {tab === 'details' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Branch details">
            <DefinitionList items={[
              ['Address', [b.address, b.city, b.state, b.pin].filter(Boolean).join(', ')],
              ['Phone', b.phone], ['Email', b.email], ['GSTIN', b.gstin], ['Opened', b.openedOn ? formatDate(b.openedOn) : null],
            ]} />
          </Card>
          <Card title="Branch Admin" actions={can('employees.manage', id) && <Button size="sm" variant="secondary" icon={<UserPlus className="h-4 w-4" />} onClick={() => setAddAdmin(true)}>Add Branch Admin</Button>}>
            {b.branchAdmins.length ? (
              <ul className="grid gap-3">
                {b.branchAdmins.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span><b>{a.user.name}</b> <span className="text-[13px] text-muted">{a.code}</span><span className="block text-[13.5px] text-muted">{a.user.email ?? a.user.mobile}</span></span>
                    {a.user.status !== 'ACTIVE' && <Badge>Inactive</Badge>}
                  </li>
                ))}
              </ul>
            ) : <Empty title="No Branch Admin yet">Add one so this branch can manage its own staff, students and batches.</Empty>}
          </Card>
        </div>
      )}
      {tab === 'rooms' && <RoomsTab branchId={id} rooms={b.rooms} manage={manage} onChange={refresh} />}
      {tab === 'holidays' && <HolidaysTab branchId={id} manage={manage} />}
      <EditBranchModal open={editing} onClose={() => setEditing(false)} branch={b} onSaved={refresh} />
      <EmployeeFormModal open={addAdmin} onClose={() => setAddAdmin(false)} presetBranchId={id} presetDesignation="Branch Admin" onSaved={refresh} />
    </>
  );
}

function EditBranchModal({ open, onClose, branch, onSaved }: { open: boolean; onClose: () => void; branch: BranchDetail; onSaved: () => void }) {
  const toast = useToast();
  const f = useForm<z.input<typeof branchSchema>>({
    resolver: zodResolver(branchSchema),
    values: {
      code: branch.code, name: branch.name, address: branch.address ?? '', city: branch.city ?? '', state: branch.state ?? '', pin: branch.pin ?? '',
      phone: branch.phone ?? '', email: branch.email ?? '', gstin: branch.gstin ?? '', openedOn: branch.openedOn?.slice(0, 10) ?? '',
    },
  });
  const m = useMutation({
    mutationFn: ({ code: _c, ...v }: z.input<typeof branchSchema>) => put(`/branches/${branch.id}`, v),
    onSuccess: () => { toast('Branch updated'); onSaved(); onClose(); },
    onError: (e) => applyServerErrors(e, f.setError as never, toast),
  });
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${branch.code}`} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={f.handleSubmit((v) => m.mutate(v))}>Save changes</Button></>}>
      <BranchFields f={f} editing />
    </Modal>
  );
}

function RoomsTab({ branchId, rooms, manage, onChange }: { branchId: string; rooms: Room[]; manage: boolean; onChange: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState<Room | 'new' | null>(null);
  const f = useForm<z.input<typeof roomSchema>>({ resolver: zodResolver(roomSchema) });
  const openEdit = (r: Room | 'new') => { setEdit(r); f.reset(r === 'new' ? { name: '', capacity: 30, active: true } : r); };
  const save = f.handleSubmit(async (v) => {
    try {
      if (edit === 'new') await post(`/branches/${branchId}/rooms`, v);
      else if (edit) await put(`/branches/${branchId}/rooms/${edit.id}`, v);
      toast('Room saved'); setEdit(null); onChange();
    } catch (e) { applyServerErrors(e, f.setError as never, toast); }
  });
  return (
    <Card title="Rooms for offline and hybrid classes" actions={manage && <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => openEdit('new')}>Add room</Button>} padded={false}>
      {!rooms.length ? <Empty title="No rooms yet" /> : (
        <table className="table">
          <thead><tr><th>Room</th><th className="text-right">Seats</th><th>Status</th>{manage && <th />}</tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td className="font-semibold">{r.name}</td>
                <td className="text-right tabular">{r.capacity}</td>
                <td><Badge tone={r.active ? 'ok' : 'neutral'}>{r.active ? 'In use' : 'Not in use'}</Badge></td>
                {manage && <td className="text-right"><Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'Add a room' : 'Edit room'} size="sm" footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button loading={f.formState.isSubmitting} onClick={save}>Save room</Button></>}>
        <div className="grid gap-4">
          <Input label="Room name" required {...f.register('name')} error={f.formState.errors.name?.message} />
          <Input label="Seats" type="number" min={1} required {...f.register('capacity')} error={f.formState.errors.capacity?.message} />
          <label className="flex items-center gap-2 text-[14.5px]"><input type="checkbox" {...f.register('active')} className="h-4 w-4" /> In use</label>
        </div>
      </Modal>
    </Card>
  );
}

export function HolidaysTab({ branchId, manage }: { branchId: string | null; manage: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const key = ['holidays', branchId ?? 'ho'];
  const q = useQuery({ queryKey: key, queryFn: () => branchId ? get<Holiday[]>(`/branches/${branchId}/holidays`) : get<Holiday[]>('/holidays') });
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      await post(branchId ? `/branches/${branchId}/holidays` : '/holidays', { date, name });
      setDate(''); setName(''); toast('Holiday added'); qc.invalidateQueries({ queryKey: key });
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  const remove = async (h: Holiday) => {
    if (!(await confirm({ title: `Remove ${h.name}?`, confirmLabel: 'Remove', danger: true })).ok) return;
    await del(branchId ? `/branches/${branchId}/holidays/${h.id}` : `/holidays/${h.id}`);
    toast('Holiday removed'); qc.invalidateQueries({ queryKey: key });
  };
  return (
    <Card title={branchId ? 'Holidays (head office + this branch)' : 'Head-office holidays (all branches)'}>
      <p className="mb-4 text-[14px] text-muted">Classes are not scheduled on these days.</p>
      {manage && (
        <div className="mb-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
          <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Holiday" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onam" />
          <Button onClick={add} loading={busy} disabled={!date || name.trim().length < 2}>Add holiday</Button>
        </div>
      )}
      {q.isLoading ? <Spinner /> : !q.data?.length ? <Empty title="No holidays yet" /> : (
        <ul className="divide-y divide-line">
          {q.data.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span><b className="tabular">{formatWeekdayDate(h.date)}</b> · {h.name}</span>
              <span className="flex items-center gap-2">
                <Badge tone={h.branchId ? 'accent' : 'brand'} dot={false}>{h.branchId ? 'This branch' : 'Head office'}</Badge>
                {manage && (!!h.branchId === !!branchId) && <Button size="sm" variant="ghost" aria-label={`Remove ${h.name}`} onClick={() => remove(h)}><Trash2 className="h-4 w-4" /></Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
