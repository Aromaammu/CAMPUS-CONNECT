import { useQuery, useQueryClient } from '@tanstack/react-query';
import { STUDENT_STATUS, formatDate, formatDateTime } from '@cc/shared';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, DefinitionList, ErrorBox, Modal, PageHeader, Select, Spinner, StatusBadge, Textarea, useConfirm, useToast } from '@/components/ui';
import { get, patch, post } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { StudentFormModal, StudentRow } from './StudentsPage';
import { StudentDetailExtras } from './StudentDetailExtras';

export function StudentDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const q = useQuery({ queryKey: ['student', id], queryFn: () => get<StudentRow>(`/students/${id}`) });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const s = q.data;
  const manage = can('students.manage', s.branchId);
  const refresh = () => qc.invalidateQueries({ queryKey: ['student', id] });
  const sendLink = async () => { await post(`/students/${id}/password-link`); toast(`A set-password link was sent to ${s.user.name}`); };
  const toggleLogin = async () => {
    const off = s.user.status === 'ACTIVE';
    if (!(await confirm({ title: off ? 'Block login?' : 'Allow login?', body: off ? `${s.user.name} will be logged out and cannot log in.` : `${s.user.name} can log in again.`, confirmLabel: off ? 'Block login' : 'Allow login', danger: off })).ok) return;
    await patch(`/students/${id}/login`, { active: !off });
    toast(off ? 'Login blocked' : 'Login allowed');
    refresh();
  };
  const saveStatus = async () => {
    await patch(`/students/${id}/status`, { status, note });
    toast('Status changed'); setStatusOpen(false); refresh(); qc.invalidateQueries({ queryKey: ['students'] });
  };
  return (
    <>
      <PageHeader
        back={{ to: '/students', label: 'Students' }}
        title={<span className="flex flex-wrap items-center gap-3"><Avatar name={s.user.name} size={40} />{s.user.name}<StatusBadge status={s.status} labels={STUDENT_STATUS} /></span>}
        subtitle={<span className="font-mono">{s.code} · {s.branch.code}</span>}
        actions={manage && <>
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit details</Button>
          <Button variant="secondary" onClick={() => { setStatus(s.status); setNote(''); setStatusOpen(true); }}>Change status</Button>
        </>}
      />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Details">
          <DefinitionList items={[
            ['Email', s.user.email], ['Mobile', s.user.mobile], ['Date of birth', s.dob ? formatDate(s.dob) : null], ['Address', s.address],
            ['Guardian', s.guardianName ? `${s.guardianName}${s.guardianPhone ? ` · ${s.guardianPhone}` : ''}` : null], ['Home branch', `${s.branch.code} · ${s.branch.name}`],
          ]} />
        </Card>
        <Card title="Login" actions={manage && <>
          <Button size="sm" variant="secondary" onClick={sendLink}>Send password link</Button>
          <Button size="sm" variant={s.user.status === 'ACTIVE' ? 'danger' : 'secondary'} onClick={toggleLogin}>{s.user.status === 'ACTIVE' ? 'Block login' : 'Allow login'}</Button>
        </>}>
          <DefinitionList items={[
            ['Login', <Badge key="l" tone={s.user.status === 'ACTIVE' ? 'ok' : 'bad'}>{s.user.status === 'ACTIVE' ? 'Allowed' : 'Blocked'}</Badge>],
            ['Password', s.user.mustChangePassword ? 'Not set yet (welcome link sent)' : 'Set by the student'],
            ['Last login', s.user.lastLoginAt ? formatDateTime(s.user.lastLoginAt) : 'Never'],
          ]} />
        </Card>
      </div>
      <StudentDetailExtras student={s} />
      <StudentFormModal open={editing} onClose={() => setEditing(false)} student={s} onSaved={refresh} />
      <Modal open={statusOpen} onClose={() => setStatusOpen(false)} title="Change student status" size="sm"
        footer={<><Button variant="secondary" onClick={() => setStatusOpen(false)}>Cancel</Button><Button onClick={saveStatus} disabled={status === s.status}>Save status</Button></>}>
        <div className="grid gap-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={Object.entries(STUDENT_STATUS).map(([value, label]) => ({ value, label }))} />
          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}
