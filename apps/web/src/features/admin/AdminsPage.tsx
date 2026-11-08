import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MODULES, MODULE_KEYS, ModuleKey, adminSchema, formatDateTime } from '@cc/shared';
import { Plus, UserCog } from 'lucide-react';
import { useEffect } from 'react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Avatar, Badge, Button, Card, Checkbox, Empty, ErrorBox, Input, Modal, PageHeader, Spinner, useConfirm, useToast } from '@/components/ui';
import { get, patch, post, put } from '@/lib/api';
import { applyServerErrors } from '../org/BranchesPage';

interface AdminRow { id: string; name: string; email: string; mobile: string; status: 'ACTIVE' | 'INACTIVE'; lastLoginAt: string | null; modules: ModuleKey[] }

export function AdminsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admins'], queryFn: () => get<AdminRow[]>('/admins') });
  const [edit, setEdit] = useState<AdminRow | 'new' | null>(null);
  const toggle = async (a: AdminRow) => {
    const off = a.status === 'ACTIVE';
    if (!(await confirm({ title: off ? `Deactivate ${a.name}?` : `Reactivate ${a.name}?`, body: off ? 'They will be logged out and lose access to all modules.' : 'They get their modules back.', confirmLabel: off ? 'Deactivate' : 'Reactivate', danger: off })).ok) return;
    await patch(`/admins/${a.id}/status`, { status: off ? 'INACTIVE' : 'ACTIVE' });
    toast(off ? 'Admin deactivated' : 'Admin reactivated');
    qc.invalidateQueries({ queryKey: ['admins'] });
  };
  return (
    <>
      <PageHeader title="Admins & modules" subtitle="Give each Admin control of one or more modules across every branch" actions={<Button icon={<Plus className="h-4 w-4" />} onClick={() => setEdit('new')}>Add admin</Button>} />
      <Card className="mb-5">
        <div className="grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
          {MODULE_KEYS.map((m) => <p key={m}><b>{MODULES[m].label}:</b> <span className="text-muted">{MODULES[m].description}</span></p>)}
        </div>
      </Card>
      {q.isLoading ? <Spinner /> : q.error ? <ErrorBox error={q.error} /> : !q.data?.length ? <Card><Empty title="No admins yet" icon={<UserCog className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-3">
          {q.data.map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={a.name} size={40} />
                  <div className="min-w-0">
                    <p className="font-bold">{a.name} {a.status !== 'ACTIVE' && <Badge>Inactive</Badge>}</p>
                    <p className="text-[13.5px] text-muted">{a.email} · {a.mobile} · last login {a.lastLoginAt ? formatDateTime(a.lastLoginAt) : 'never'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEdit(a)}>Edit modules</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle(a)}>{a.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}</Button>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">{a.modules.map((m) => <Badge key={m} tone="brand">{MODULES[m]?.label ?? m}</Badge>)}</div>
            </Card>
          ))}
        </div>
      )}
      <AdminModal open={!!edit} onClose={() => setEdit(null)} admin={edit === 'new' ? null : edit} />
    </>
  );
}

function AdminModal({ open, onClose, admin }: { open: boolean; onClose: () => void; admin: AdminRow | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const f = useForm<z.input<typeof adminSchema>>({ resolver: zodResolver(adminSchema) });
  useEffect(() => { if (open) f.reset(admin ? { name: admin.name, email: admin.email, mobile: admin.mobile, modules: admin.modules } : { name: '', email: '', mobile: '', modules: [] }); }, [open, admin, f]);
  const modules = f.watch('modules') ?? [];
  const save = f.handleSubmit(async (v) => {
    try {
      if (admin) await put(`/admins/${admin.id}`, v); else await post('/admins', v);
      toast(admin ? 'Admin updated' : `${v.name} added. A welcome email and SMS are on the way.`);
      qc.invalidateQueries({ queryKey: ['admins'] });
      onClose();
    } catch (e) { applyServerErrors(e, f.setError as never, toast); }
  });
  const e = f.formState.errors;
  return (
    <Modal open={open} onClose={onClose} title={admin ? `Edit ${admin.name}` : 'Add an admin'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={f.formState.isSubmitting} onClick={save}>{admin ? 'Save changes' : 'Add admin'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Input label="Full name" required {...f.register('name')} error={e.name?.message} />
        <Input label="Email" type="email" required {...f.register('email')} error={e.email?.message} />
        <Input label="Mobile" required {...f.register('mobile')} error={e.mobile?.message} />
      </div>
      <fieldset className="mt-5">
        <legend className="label">Modules (all branches)</legend>
        {e.modules && <p className="err mb-2">{e.modules.message}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {MODULE_KEYS.map((m) => (
            <Checkbox key={m} checked={modules.includes(m)} onChange={(ev) => f.setValue('modules', ev.target.checked ? [...modules, m] : modules.filter((x) => x !== m), { shouldValidate: true })}
              label={<span><b>{MODULES[m].label}</b><span className="block text-[13px] text-muted">{MODULES[m].description}</span></span>} />
          ))}
        </div>
      </fieldset>
    </Modal>
  );
}
