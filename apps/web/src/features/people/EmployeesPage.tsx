import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Users } from 'lucide-react';
import { useState } from 'react';
import { Avatar, Badge, Button, Card, Empty, MobileCards, ErrorBox, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { BranchSelect, FilterBar, ImportButton, ImportDialog, Paged, useDebounced } from '@/components/data';
import { get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EmployeeFormModal, EmployeeRow, useStructure } from './EmployeeForm';

export function EmployeesPage() {
  const { can, user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [designationId, setDesignationId] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const [edit, setEdit] = useState<EmployeeRow | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<EmployeeRow | null>(null);
  const structure = useStructure(branchId || '');
  const list = useQuery({
    queryKey: ['employees', branchId, designationId, status, dq, page],
    queryFn: () => get<Paged<EmployeeRow>>('/employees', { branchId, designationId, status, q: dq, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const canManage = can('employees.manage');
  const action = async (kind: 'link' | 'toggle', e: EmployeeRow) => {
    setMenu(null);
    if (kind === 'link') {
      await post(`/employees/${e.id}/password-link`);
      toast(`A set-password link was sent to ${e.user.name}`);
      return;
    }
    const off = e.user.status === 'ACTIVE';
    if (!(await confirm({ title: off ? `Deactivate ${e.user.name}?` : `Reactivate ${e.user.name}?`, body: off ? 'They will be logged out and cannot log in until reactivated. Their history is kept.' : 'They can log in again.', confirmLabel: off ? 'Deactivate' : 'Reactivate', danger: off })).ok) return;
    try {
      await patch(`/employees/${e.id}/status`, { status: off ? 'INACTIVE' : 'ACTIVE' });
      toast(off ? 'Employee deactivated' : 'Employee reactivated');
      qc.invalidateQueries({ queryKey: ['employees'] });
    } catch (err) { toast((err as Error).message, 'bad'); }
  };
  return (
    <>
      <PageHeader title="Employees" subtitle="Teachers, accountants and other staff"
        actions={canManage && <>
          <ImportButton onClick={() => setImporting(true)} />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add employee</Button>
        </>} />
      <FilterBar>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, ID, email, mobile" className="self-end" />
        <BranchSelect allowAll={user?.branchIds === null || (user?.branchIds?.length ?? 0) > 1} perm="employees.view" value={branchId} onChange={(v) => { setBranchId(v); setDesignationId(''); setPage(1); }} />
        <Select label="Designation" value={designationId} onChange={(e) => { setDesignationId(e.target.value); setPage(1); }} placeholder="All designations" options={(structure.data?.designations ?? []).map((d) => ({ value: d.id, label: d.name }))} disabled={!branchId} />
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All" options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
      </FilterBar>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.rows.length ? (
        <Card><Empty title="No employees found" icon={<Users className="h-8 w-8" />}>{canManage ? 'Add employees one by one or upload an Excel sheet.' : undefined}</Empty></Card>
      ) : (
        <>
          <MobileCards rows={list.data.rows} keyOf={(e) => e.id} render={(e) => (
            <div className="flex items-center gap-3">
              <Avatar name={e.user.name} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{e.user.name}</span><span className="block truncate text-[13px] text-muted">{e.designation.name} · {e.branch.code}</span><span className="block truncate font-mono text-[12.5px] text-muted">{e.code}</span></span>
              {canManage ? <Button size="sm" variant="secondary" onClick={() => setEdit(e)}>Edit</Button> : <Badge tone={e.user.status === 'ACTIVE' ? 'ok' : 'neutral'}>{e.user.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge>}
            </div>
          )} />
          <div className="table-wrap hidden sm:block">
            <table className="table">
              <thead><tr><th>Name</th><th>Employee ID</th><th>Designation</th><th>Branch</th><th>Contact</th><th>Status</th>{canManage && <th />}</tr></thead>
              <tbody>
                {list.data.rows.map((e) => (
                  <tr key={e.id}>
                    <td><span className="flex items-center gap-2.5"><Avatar name={e.user.name} size={30} /><span className="font-semibold">{e.user.name}</span></span></td>
                    <td className="font-mono text-[13px]">{e.code}</td>
                    <td>{e.designation.name}{e.department && <span className="block text-[12.5px] text-muted">{e.department.name}</span>}</td>
                    <td>{e.branch.code}{e.extraBranches.length > 0 && <span className="block text-[12.5px] text-muted">+ {e.extraBranches.map((x) => x.branch.code).join(', ')}</span>}</td>
                    <td className="text-[13.5px]">{e.user.email ?? '—'}<span className="block text-muted">{e.user.mobile}</span></td>
                    <td><Badge tone={e.user.status === 'ACTIVE' ? 'ok' : 'neutral'}>{e.user.status === 'ACTIVE' ? 'Active' : 'Inactive'}</Badge></td>
                    {canManage && <td className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Edit</Button>
                      <Button size="sm" variant="ghost" aria-label={`More actions for ${e.user.name}`} onClick={() => setMenu(e)}><MoreHorizontal className="h-4 w-4" /></Button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
        </>
      )}
      <EmployeeFormModal open={!!edit} onClose={() => setEdit(null)} employee={edit === 'new' ? null : edit} presetBranchId={branchId} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} title="Upload employees from Excel" endpoint="/employees" branchId={branchId || user?.homeBranchId || ''} what="employees" onDone={() => qc.invalidateQueries({ queryKey: ['employees'] })} />
      <Modal open={!!menu} onClose={() => setMenu(null)} title={menu?.user.name ?? ''} size="sm">
        {menu && <div className="grid gap-2">
          <Button variant="secondary" onClick={() => action('link', menu)}>Send a set-password link</Button>
          <Button variant={menu.user.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => action('toggle', menu)}>{menu.user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>
        </div>}
      </Modal>
    </>
  );
}
