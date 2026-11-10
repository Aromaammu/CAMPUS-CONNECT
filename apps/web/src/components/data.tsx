import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Modal, Notice, Select, clsx } from '@/components/ui';
import { download, get, upload } from '@/lib/api';

export interface BranchOption { id: string; code: string; name: string }

export function useBranchOptions(perm = 'branch.view') {
  return useQuery({ queryKey: ['branch-options', perm], queryFn: () => get<BranchOption[]>('/branches/options', { perm }), staleTime: 60_000 });
}

export function BranchSelect({ value, onChange, perm, label = 'Branch', allowAll, allLabel = 'All branches', className, required, error, id }: {
  value: string; onChange: (v: string) => void; perm?: string; label?: string; allowAll?: boolean; allLabel?: string; className?: string; required?: boolean; error?: string; id?: string;
}) {
  const q = useBranchOptions(perm);
  const opts = (q.data ?? []).map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }));
  // Pick the only branch automatically. Deferred so a form that resets itself when it opens
  // (its effects run after ours) cannot wipe the choice while the screen still shows it.
  const only = !allowAll && q.data?.length === 1 ? q.data[0].id : null;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (!only || value) return;
    const t = setTimeout(() => onChangeRef.current(only), 0);
    return () => clearTimeout(t);
  }, [only, value]);
  return (
    <Select id={id} label={label} className={className} value={value} onChange={(e) => onChange(e.target.value)} options={opts} placeholder={allowAll ? allLabel : q.isLoading ? 'Loading…' : !value ? 'Choose a branch' : undefined} required={required} error={error} />
  );
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export interface Paged<T> { total: number; page: number; pageSize: number; rows: T[] }

interface ImportRow { row: number; name: string; ok: boolean; errors: string[] }
interface ImportReport { total: number; valid: number; invalid: number; created: number; rows: ImportRow[] }

/** Excel bulk upload: download template → upload → see report → import the good rows. */
export function ImportDialog({ open, onClose, title, endpoint, branchId, what, onDone }: {
  open: boolean; onClose: () => void; title: string; endpoint: '/students' | '/employees'; branchId: string; what: string; onDone: () => void;
}) {
  const fid = useId();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [bid, setBid] = useState(branchId);
  useEffect(() => { if (open) { setFile(null); setReport(null); setErr(''); setBid(branchId); } }, [open, branchId]);
  const send = async (commit: boolean) => {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await upload<ImportReport>(`${endpoint}/import?branchId=${bid}${commit ? '&commit=1' : ''}`, form);
      setReport(r);
      if (commit) onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const done = report && report.created > 0;
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" footer={done ? <Button onClick={onClose}>Done</Button> : <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      {report ? (
        <Button onClick={() => send(true)} loading={busy} disabled={!report.valid}>Import {report.valid} {what}</Button>
      ) : (
        <Button onClick={() => send(false)} loading={busy} disabled={!file || !bid} icon={<Upload className="h-4 w-4" />}>Check file</Button>
      )}
    </>}>
      {!branchId && <BranchSelect className="mb-4" label="Import into branch" perm={endpoint === '/students' ? 'students.manage' : 'employees.manage'} value={bid} onChange={(v) => { setBid(v); setReport(null); }} />}
      <ol className="grid gap-4 text-[14.5px]">
        <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface-2 px-4 py-3">
          <span><b>1.</b> Download the Excel template and fill one row per person.</span>
          <Button size="sm" variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => download(`${endpoint}/import/template`)}>Template</Button>
        </li>
        <li className="rounded-lg bg-surface-2 px-4 py-3">
          <label htmlFor={fid} className="block"><b>2.</b> Choose the filled file (.xlsx)</label>
          <input id={fid} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block w-full text-[14px]" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setReport(null); }} />
        </li>
      </ol>
      {err && <div className="mt-4"><Notice tone="bad">{err}</Notice></div>}
      {report && (
        <div className="mt-4 grid gap-3">
          {done ? <Notice tone="ok" title={`${report.created} ${what} imported`}>Each one has been sent a welcome email and SMS with a link to set their password.</Notice> : (
            <Notice tone={report.invalid ? 'warn' : 'ok'} title={`${report.valid} of ${report.total} rows are ready`}>
              {report.invalid ? 'Rows with problems will be skipped. Fix them in Excel and upload again later.' : 'Everything looks good.'}
            </Notice>
          )}
          <div className="table-wrap max-h-72 overflow-y-auto">
            <table className="table">
              <thead><tr><th>Row</th><th>Name</th><th>Result</th></tr></thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr key={r.row}>
                    <td className="tabular text-muted">{r.row}</td>
                    <td>{r.name || '—'}</td>
                    <td>{r.ok ? <Badge tone="ok">Ready</Badge> : <span className="text-[13.5px] text-bad">{r.errors.join(' · ')}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&_label]:text-[12.5px]', className)}>{children}</div>;
}

export function ImportButton({ onClick }: { onClick: () => void }) {
  return <Button variant="secondary" icon={<FileSpreadsheet className="h-4 w-4" />} onClick={onClick}>Upload Excel</Button>;
}
