import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BRANCH_PERMISSIONS, MODULES, PERMISSIONS, Permission, employeeSchema } from '@cc/shared';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button, Checkbox, Input, Modal, Select, useToast } from '@/components/ui';
import { BranchSelect, useBranchOptions } from '@/components/data';
import { get, post, put } from '@/lib/api';
import { applyServerErrors } from '../org/BranchesPage';

export interface Designation { id: string; name: string; permissions: string[]; departmentId: string | null; department?: { name: string } | null; _count?: { employees: number } }
export interface Department { id: string; name: string; _count?: { employees: number } }
export interface Structure { departments: Department[]; designations: Designation[] }

export function useStructure(branchId: string | null) {
  return useQuery({ queryKey: ['org-structure', branchId ?? 'templates'], queryFn: () => get<Structure>('/org/structure', { branchId: branchId ?? '' }), enabled: branchId !== '' });
}

export interface EmployeeRow {
  id: string; code: string; branchId: string; designationId: string; departmentId: string | null; joiningDate: string | null; extraPermissions: string[]; removedPermissions: string[];
  user: { id: string; name: string; email: string | null; mobile: string | null; status: 'ACTIVE' | 'INACTIVE'; lastLoginAt: string | null };
  branch: { id: string; code: string; name: string }; designation: { id: string; name: string; permissions: string[] }; department: { id: string; name: string } | null;
  extraBranches: { branch: { id: string; code: string; name: string } }[];
}

type Form = z.input<typeof employeeSchema>;

export function EmployeeFormModal({ open, onClose, employee, presetBranchId, presetDesignation, onSaved }: {
  open: boolean; onClose: () => void; employee?: EmployeeRow | null; presetBranchId?: string; presetDesignation?: string; onSaved?: () => void;
}) {
  const toast = useToast();
  const qc = useQueryClient();
  const f = useForm<Form>({ resolver: zodResolver(employeeSchema) });
  const branchId = f.watch('branchId') ?? '';
  const designationId = f.watch('designationId') ?? '';
  const structure = useStructure(branchId || '');
  const manageable = useBranchOptions('employees.manage');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [showPerms, setShowPerms] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowPerms(false);
    f.reset(employee ? {
      name: employee.user.name, email: employee.user.email ?? '', mobile: employee.user.mobile ?? '', branchId: employee.branchId, designationId: employee.designationId,
      departmentId: employee.departmentId ?? '', joiningDate: employee.joiningDate?.slice(0, 10) ?? '', extraBranchIds: employee.extraBranches.map((x) => x.branch.id),
      extraPermissions: employee.extraPermissions, removedPermissions: employee.removedPermissions,
    } : { name: '', email: '', mobile: '', branchId: presetBranchId ?? '', designationId: '', departmentId: '', joiningDate: '', extraBranchIds: [], extraPermissions: [], removedPermissions: [] });
  }, [open, employee, presetBranchId, f]);

  const designation = structure.data?.designations.find((d) => d.id === designationId);
  useEffect(() => {
    if (open && presetDesignation && structure.data && !f.getValues('designationId')) {
      const d = structure.data.designations.find((x) => x.name === presetDesignation);
      if (d) f.setValue('designationId', d.id);
    }
  }, [open, presetDesignation, structure.data, f]);
  useEffect(() => {
    if (!designation) return;
    const set = new Set(designation.permissions);
    (f.getValues('extraPermissions') ?? []).forEach((p) => set.add(p));
    (f.getValues('removedPermissions') ?? []).forEach((p) => set.delete(p));
    setPerms(set);
  }, [designation, f]);

  const grouped = useMemo(() => {
    const g: Record<string, Permission[]> = {};
    for (const p of BRANCH_PERMISSIONS) (g[PERMISSIONS[p].module] ??= []).push(p);
    return g;
  }, []);

  const save = f.handleSubmit(async (v) => {
    const base = new Set(designation?.permissions ?? []);
    const extra = [...perms].filter((p) => !base.has(p));
    const removed = [...base].filter((p) => !perms.has(p));
    const body = { ...v, extraPermissions: extra, removedPermissions: removed };
    try {
      if (employee) await put(`/employees/${employee.id}`, body);
      else await post('/employees', body);
      toast(employee ? 'Employee updated' : `${v.name} added. A welcome email and SMS are on the way.`);
      qc.invalidateQueries({ queryKey: ['employees'] });
      onSaved?.();
      onClose();
    } catch (e) { applyServerErrors(e, f.setError as never, toast); }
  });

  const extraIds = f.watch('extraBranchIds') ?? [];
  const e = f.formState.errors;
  return (
    <Modal open={open} onClose={onClose} title={employee ? `Edit ${employee.user.name}` : presetDesignation ? `Add a ${presetDesignation}` : 'Add an employee'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={f.formState.isSubmitting} onClick={save}>{employee ? 'Save changes' : 'Add employee'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required {...f.register('name')} error={e.name?.message} />
        <Input label="Mobile" required inputMode="tel" {...f.register('mobile')} error={e.mobile?.message} />
        <Input label="Email" type="email" help="Used to log in and for the welcome link" {...f.register('email')} error={e.email?.message} />
        <Input label="Joining date" type="date" {...f.register('joiningDate')} error={e.joiningDate?.message} />
        <BranchSelect label="Home branch" perm="employees.manage" value={branchId} onChange={(v) => { f.setValue('branchId', v); if (!presetDesignation) f.setValue('designationId', ''); }} required error={e.branchId?.message} />
        <Select label="Designation" required value={designationId} onChange={(ev) => f.setValue('designationId', ev.target.value, { shouldValidate: true })}
          options={(structure.data?.designations ?? []).map((d) => ({ value: d.id, label: d.name }))} placeholder="Choose…" error={e.designationId?.message} />
        <Select label="Department" {...f.register('departmentId')} options={(structure.data?.departments ?? []).map((d) => ({ value: d.id, label: d.name }))} placeholder="Same as designation" />
      </div>
      {(manageable.data?.length ?? 0) > 1 && (
        <fieldset className="mt-5">
          <legend className="label">Also works in these branches</legend>
          <p className="help mb-2">For teachers who take batches in more than one branch.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {manageable.data!.filter((b) => b.id !== branchId).map((b) => (
              <Checkbox key={b.id} label={`${b.code} · ${b.name}`} checked={extraIds.includes(b.id)}
                onChange={(ev) => f.setValue('extraBranchIds', ev.target.checked ? [...extraIds, b.id] : extraIds.filter((x) => x !== b.id))} />
            ))}
          </div>
        </fieldset>
      )}
      {designation && (
        <div className="mt-5 rounded-lg border border-line">
          <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left text-[14.5px] font-semibold" onClick={() => setShowPerms((s) => !s)} aria-expanded={showPerms}>
            <span>Permissions <span className="font-normal text-muted">· from {designation.name}{perms.size !== designation.permissions.length || [...perms].some((p) => !designation.permissions.includes(p)) ? ', adjusted' : ''}</span></span>
            <ChevronDown className={`h-4 w-4 transition-transform ${showPerms ? 'rotate-180' : ''}`} />
          </button>
          {showPerms && (
            <div className="grid gap-4 border-t border-line px-4 py-4 sm:grid-cols-2">
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
          )}
        </div>
      )}
    </Modal>
  );
}
