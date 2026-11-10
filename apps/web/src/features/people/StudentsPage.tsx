import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { STUDENT_STATUS, formatDate, studentSchema } from '@cc/shared';
import { GraduationCap, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Avatar, Button, Card, Empty, MobileCards, ErrorBox, Input, Modal, PageHeader, Pagination, SearchInput, Select, Spinner, StatusBadge, useToast } from '@/components/ui';
import { BranchSelect, FilterBar, ImportButton, ImportDialog, Paged, useDebounced } from '@/components/data';
import { get, post, put } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { applyServerErrors } from '../org/BranchesPage';

export interface StudentRow {
  id: string; code: string; branchId: string; dob: string | null; address: string | null; guardianName: string | null; guardianPhone: string | null;
  status: keyof typeof STUDENT_STATUS; createdAt: string;
  user: { id: string; name: string; email: string | null; mobile: string | null; status: 'ACTIVE' | 'INACTIVE'; lastLoginAt: string | null; mustChangePassword: boolean };
  branch: { id: string; code: string; name: string };
  _count?: { enrolments: number };
}

export function StudentsPage() {
  const { can, user } = useAuth();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const list = useQuery({
    queryKey: ['students', branchId, status, dq, page],
    queryFn: () => get<Paged<StudentRow>>('/students', { branchId, status, q: dq, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const canManage = can('students.manage');
  return (
    <>
      <PageHeader title="Students" subtitle="Everyone enrolled or registered at your branches"
        actions={canManage && <>
          <ImportButton onClick={() => setImporting(true)} />
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add student</Button>
        </>} />
      <FilterBar>
        <SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name, ID, email, mobile" className="self-end sm:col-span-2" />
        <BranchSelect allowAll={user?.branchIds === null || (user?.branchIds?.length ?? 0) > 1} perm="students.view" value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} />
        <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} placeholder="All" options={Object.entries(STUDENT_STATUS).map(([value, label]) => ({ value, label }))} />
      </FilterBar>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.rows.length ? (
        <Card><Empty title="No students found" icon={<GraduationCap className="h-8 w-8" />}>{canManage ? 'Add students one by one or upload an Excel sheet.' : undefined}</Empty></Card>
      ) : (
        <>
          <MobileCards rows={list.data.rows} keyOf={(s) => s.id} render={(s) => (
            <Link to={`/students/${s.id}`} className="flex items-center gap-3">
              <Avatar name={s.user.name} size={36} />
              <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{s.user.name}</span><span className="block truncate font-mono text-[12.5px] text-muted">{s.code}</span><span className="block truncate text-[13px] text-muted">{s.user.mobile}</span></span>
              <StatusBadge status={s.status} labels={STUDENT_STATUS} />
            </Link>
          )} />
          <div className="table-wrap hidden sm:block">
            <table className="table">
              <thead><tr><th>Student</th><th>Student ID</th><th>Branch</th><th>Contact</th><th className="text-right">Enrolments</th><th>Status</th></tr></thead>
              <tbody>
                {list.data.rows.map((s) => (
                  <tr key={s.id}>
                    <td><Link to={`/students/${s.id}`} className="flex items-center gap-2.5 font-semibold hover:underline"><Avatar name={s.user.name} size={30} />{s.user.name}</Link></td>
                    <td className="font-mono text-[13px]">{s.code}</td>
                    <td>{s.branch.code}</td>
                    <td className="text-[13.5px]">{s.user.email ?? '—'}<span className="block text-muted">{s.user.mobile}</span></td>
                    <td className="text-right tabular">{s._count?.enrolments ?? 0}</td>
                    <td><StatusBadge status={s.status} labels={STUDENT_STATUS} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
        </>
      )}
      <StudentFormModal open={adding} onClose={() => setAdding(false)} presetBranchId={branchId} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} title="Upload students from Excel" endpoint="/students" branchId={branchId} what="students" onDone={() => qc.invalidateQueries({ queryKey: ['students'] })} />
    </>
  );
}

type Form = z.input<typeof studentSchema>;

export function StudentFormModal({ open, onClose, student, presetBranchId, onSaved }: { open: boolean; onClose: () => void; student?: StudentRow | null; presetBranchId?: string; onSaved?: () => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const f = useForm<Form>({ resolver: zodResolver(studentSchema) });
  // Reset only when the form opens (or switches student) — never while someone is typing.
  useEffect(() => {
    if (!open) return;
    f.reset(student ? {
      name: student.user.name, email: student.user.email ?? '', mobile: student.user.mobile ?? '', branchId: student.branchId, dob: student.dob?.slice(0, 10) ?? '',
      address: student.address ?? '', guardianName: student.guardianName ?? '', guardianPhone: student.guardianPhone ?? '',
    } : { name: '', email: '', mobile: '', branchId: presetBranchId ?? '', dob: '', address: '', guardianName: '', guardianPhone: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, student, f]);
  // The page's branch filter may settle after the form opened: just fill in the branch.
  useEffect(() => {
    if (open && !student && presetBranchId && !f.getValues('branchId')) f.setValue('branchId', presetBranchId);
  }, [open, student, presetBranchId, f]);
  const save = f.handleSubmit(async (v) => {
    try {
      if (student) await put(`/students/${student.id}`, v);
      else await post('/students', v);
      toast(student ? 'Student updated' : `${v.name} added. A welcome email and SMS are on the way.`);
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student'] });
      onSaved?.();
      onClose();
    } catch (e) { applyServerErrors(e, f.setError as never, toast); }
  });
  const e = f.formState.errors;
  return (
    <Modal open={open} onClose={onClose} title={student ? `Edit ${student.user.name}` : 'Add a student'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={f.formState.isSubmitting} onClick={save}>{student ? 'Save changes' : 'Add student'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required {...f.register('name')} error={e.name?.message} />
        <Input label="Mobile" required inputMode="tel" {...f.register('mobile')} error={e.mobile?.message} />
        <Input label="Email" type="email" help="Used to log in and for the welcome link" {...f.register('email')} error={e.email?.message} />
        <Input label="Date of birth" type="date" help="Students under 18 need a guardian's consent" {...f.register('dob')} error={e.dob?.message} />
        <BranchSelect label="Home branch" perm="students.manage" value={f.watch('branchId') ?? ''} onChange={(v) => f.setValue('branchId', v, { shouldValidate: !!f.formState.errors.branchId })} required error={e.branchId?.message} />
        <Input label="Address" {...f.register('address')} error={e.address?.message} />
        <Input label="Parent / guardian name" {...f.register('guardianName')} error={e.guardianName?.message} />
        <Input label="Parent / guardian mobile" inputMode="tel" {...f.register('guardianPhone')} error={e.guardianPhone?.message} />
      </div>
      {student && <p className="help mt-4">Joined {formatDate(student.createdAt)}. Guardians do not get a login.</p>}
    </Modal>
  );
}
