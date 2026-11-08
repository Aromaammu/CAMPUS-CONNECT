import { useQueryClient } from '@tanstack/react-query';
import { BRANCH_PERMISSIONS, MODULES, PERMISSIONS, Permission } from '@cc/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Input, Modal, PageHeader, Select, Spinner, useConfirm, useToast } from '@/components/ui';
import { useBranchOptions } from '@/components/data';
import { del, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Department, Designation, useStructure } from '../people/EmployeeForm';

export function DesignationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const isHeadOffice = user?.kind === 'SUPER_ADMIN' || (user?.kind === 'ADMIN' && user.permissions.includes('org.manage'));
  const branches = useBranchOptions('org.manage');
  const [branchId, setBranchId] = useState<string>(isHeadOffice ? 'templates' : '');
  const effective = branchId || branches.data?.[0]?.id || '';
  const scope = effective === 'templates' ? null : effective;
  const s = useStructure(effective ? scope : '');
  const [desig, setDesig] = useState<Designation | 'new' | null>(null);
  const [dept, setDept] = useState<Department | 'new' | null>(null);
  const qs = scope ? `?branchId=${scope}` : '';
  const refresh = () => qc.invalidateQueries({ queryKey: ['org-structure'] });
  const removeDesig = async (d: Designation) => {
    if (!(await confirm({ title: `Remove ${d.name}?`, confirmLabel: 'Remove', danger: true })).ok) return;
    try { await del(`/org/designations/${d.id}`); toast('Designation removed'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const removeDept = async (d: Department) => {
    if (!(await confirm({ title: `Remove ${d.name}?`, confirmLabel: 'Remove', danger: true })).ok) return;
    try { await del(`/org/departments/${d.id}`); toast('Department removed'); refresh(); } catch (e) { toast((e as Error).message, 'bad'); }
  };
  const options = [
    ...(isHeadOffice ? [{ value: 'templates', label: 'Head-office templates (new branches start with these)' }] : []),
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })),
  ];
  return (
    <>
      <PageHeader title="Departments & designations" subtitle="A designation decides what its employees can do" />
      <Select className="mb-5 max-w-lg" label="Show" value={effective} onChange={(e) => setBranchId(e.target.value)} options={options} />
      {s.isLoading ? <Spinner /> : s.error ? <ErrorBox error={s.error} /> : s.data && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card title="Departments" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDept('new')}>Add</Button>} padded={false}>
            {!s.data.departments.length ? <Empty title="No departments" /> : (
              <ul className="divide-y divide-line">
                {s.data.departments.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="font-semibold">{d.name}{scope && <span className="ml-2 text-[13px] font-normal text-muted">{d._count?.employees ?? 0} staff</span>}</span>
                    <span className="flex">
                      <Button size="sm" variant="ghost" aria-label={`Rename ${d.name}`} onClick={() => setDept(d)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${d.name}`} onClick={() => removeDept(d)}><Trash2 className="h-4 w-4" /></Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Designations" actions={<Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDesig('new')}>Add</Button>} padded={false}>
            {!s.data.designations.length ? <Empty title="No designations" /> : (
              <ul className="divide-y divide-line">
                {s.data.designations.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{d.name} <span className="text-[13px] font-normal text-muted">{d.department?.name ?? ''}{scope ? ` · ${d._count?.employees ?? 0} staff` : ''}</span></p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {d.permissions.length === BRANCH_PERMISSIONS.length ? <Badge tone="brand" dot={false}>Everything in the branch</Badge>
                          : d.permissions.map((p) => <Badge key={p} dot={false}>{PERMISSIONS[p as Permission]?.label ?? p}</Badge>)}
                      </div>
                    </div>
                    <span className="flex">
                      <Button size="sm" variant="ghost" onClick={() => setDesig(d)}>Edit</Button>
                      <Button size="sm" variant="ghost" aria-label={`Remove ${d.name}`} onClick={() => removeDesig(d)}><Trash2 className="h-4 w-4" /></Button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
      <DesignationModal open={!!desig} onClose={() => setDesig(null)} designation={desig === 'new' ? null : desig} departments={s.data?.departments ?? []} qs={qs} onSaved={refresh} />
      <DepartmentModal open={!!dept} onClose={() => setDept(null)} department={dept === 'new' ? null : dept} qs={qs} onSaved={refresh} />
    </>
  );
}

function DesignationModal({ open, onClose, designation, departments, qs, onSaved }: { open: boolean; onClose: () => void; designation: Designation | null; departments: Department[]; qs: string; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) {
    setLastOpen(true);
    setName(designation?.name ?? '');
    setDepartmentId(designation?.departmentId ?? '');
    setPerms(new Set(designation?.permissions ?? []));
  }
  if (!open && lastOpen) setLastOpen(false);
  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of BRANCH_PERMISSIONS) (g[PERMISSIONS[p].module] ??= []).push(p);
    return g;
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      const body = { name, departmentId, permissions: [...perms] };
      if (designation) await put(`/org/designations/${designation.id}`, body);
      else await post(`/org/designations${qs}`, body);
      toast('Designation saved'); onSaved(); onClose();
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={designation ? `Edit ${designation.name}` : 'Add a designation'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save} disabled={name.trim().length < 2}>Save designation</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} options={departments.map((d) => ({ value: d.id, label: d.name }))} placeholder="None" />
      </div>
      <div className="mt-5 flex items-center justify-between">
        <h3 className="text-[15px] font-bold">What this designation can do</h3>
        <Button size="sm" variant="ghost" onClick={() => setPerms(perms.size === BRANCH_PERMISSIONS.length ? new Set() : new Set(BRANCH_PERMISSIONS))}>{perms.size === BRANCH_PERMISSIONS.length ? 'Clear all' : 'Select all'}</Button>
      </div>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {Object.entries(grouped).map(([mod, list]) => (
          <div key={mod}>
            <div className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-muted">{MODULES[mod as keyof typeof MODULES].label}</div>
            <div className="grid gap-1.5">
              {list.map((p) => (
                <Checkbox key={p} label={<span className="text-[14px]">{PERMISSIONS[p].label}</span>} checked={perms.has(p)}
                  onChange={(ev) => setPerms((s) => { const n = new Set(s); if (ev.target.checked) n.add(p); else n.delete(p); return n; })} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function DepartmentModal({ open, onClose, department, qs, onSaved }: { open: boolean; onClose: () => void; department: Department | null; qs: string; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [lastOpen, setLastOpen] = useState(false);
  if (open && !lastOpen) { setLastOpen(true); setName(department?.name ?? ''); }
  if (!open && lastOpen) setLastOpen(false);
  const save = async () => {
    try {
      if (department) await put(`/org/departments/${department.id}`, { name });
      else await post(`/org/departments${qs}`, { name });
      toast('Department saved'); onSaved(); onClose();
    } catch (e) { toast((e as Error).message, 'bad'); }
  };
  return (
    <Modal open={open} onClose={onClose} title={department ? 'Rename department' : 'Add a department'} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={name.trim().length < 2}>Save</Button></>}>
      <Input label="Department name" value={name} onChange={(e) => setName(e.target.value)} />
    </Modal>
  );
}
