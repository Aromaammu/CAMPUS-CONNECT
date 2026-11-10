import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@cc/shared';
import { Download, ExternalLink, FileText, Link2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Input, Modal, Select, Spinner, Tabs, useConfirm, useToast } from '@/components/ui';
import { ApiError, del, get, post, upload } from '@/lib/api';
import type { BatchDetail, SessionRow } from '../academics/types';

interface MaterialRow {
  id: string; title: string; kind: 'FILE' | 'LINK' | 'WHITEBOARD'; url: string | null; createdAt: string; canDelete: boolean;
  module: { id: string; position: number; title: string } | null; session: { id: string; position: number; startsAt: string } | null;
  file: { id: string; name: string; mime: string; sizeBytes: number } | null; shares: { batchId: string }[];
}
interface MaterialsResult { canManage: boolean; modules: { id: string; position: number; title: string }[]; rows: MaterialRow[] }

const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Opens a material: links in a new tab, files through a short-lived private link. */
export async function openMaterial(id: string, download = false) {
  const r = await get<{ url: string; external: boolean }>(`/materials/${id}/open`, { download: download ? 1 : undefined });
  if (download && !r.external) { window.location.href = r.url; return; }
  window.open(r.url, '_blank', 'noopener');
}

/** Batch page tab (PRD §9.1): materials grouped by course module. */
export function MaterialsTab({ batch }: { batch: BatchDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['materials', batch.id], queryFn: () => get<MaterialsResult>(`/batches/${batch.id}/materials`) });
  const remove = useMutation({
    mutationFn: (id: string) => del(`/materials/${id}`),
    onSuccess: () => { toast('Material deleted'); void qc.invalidateQueries({ queryKey: ['materials', batch.id] }); },
    onError: (e) => toast((e as Error).message, 'bad'),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} retry={q.refetch} />;
  const { rows, modules, canManage } = q.data;
  const groups = [
    ...modules.map((m) => ({ key: m.id, title: `Module ${m.position}: ${m.title}`, items: rows.filter((r) => r.module?.id === m.id) })),
    { key: 'other', title: 'Other materials', items: rows.filter((r) => !r.module) },
  ].filter((g) => g.items.length);
  return (
    <div className="grid gap-4">
      {canManage && <div><Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Add material</Button></div>}
      {!rows.length ? <Card><Empty title="No materials yet" icon={<FileText className="h-8 w-8" />}>{canManage ? 'Add notes, slides or links for this batch.' : 'Your teacher will share notes and slides here.'}</Empty></Card> : groups.map((g) => (
        <Card key={g.key} title={g.title} padded={false}>
          <ul className="divide-y divide-line" aria-label={g.title}>
            {g.items.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                {m.kind === 'LINK' ? <Link2 className="h-5 w-5 shrink-0 text-brand" /> : <FileText className="h-5 w-5 shrink-0 text-brand" />}
                <div className="min-w-0 flex-1">
                  <button type="button" className="text-left font-semibold text-brand hover:underline" onClick={() => void openMaterial(m.id).catch((e) => toast((e as Error).message, 'bad'))}>{m.title}</button>
                  <div className="text-[13px] text-muted">
                    {m.kind === 'LINK' ? 'Link' : m.kind === 'WHITEBOARD' ? 'Whiteboard' : m.file ? `${m.file.name} · ${size(m.file.sizeBytes)}` : 'File'}
                    {m.session ? ` · class ${m.session.position}` : ''} · added {formatDate(m.createdAt)}
                    {m.shares.length > 1 && ` · shared with ${m.shares.length} batches`}
                  </div>
                </div>
                {m.kind === 'LINK'
                  ? <Button size="sm" variant="ghost" icon={<ExternalLink className="h-4 w-4" />} onClick={() => void openMaterial(m.id)}>Open</Button>
                  : <Button size="sm" variant="ghost" icon={<Download className="h-4 w-4" />} onClick={() => void openMaterial(m.id, true).catch((e) => toast((e as Error).message, 'bad'))}>Download</Button>}
                {m.canDelete && <Button size="sm" variant="ghost" className="text-bad" aria-label={`Delete ${m.title}`} icon={<Trash2 className="h-4 w-4" />} onClick={async () => {
                  const c = await confirm({ title: `Delete "${m.title}"?`, body: 'It will be removed from every batch it was shared with.', confirmLabel: 'Delete', danger: true });
                  if (c.ok) remove.mutate(m.id);
                }} />}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {adding && <AddMaterial batch={batch} modules={modules} onClose={() => setAdding(false)} />}
    </div>
  );
}

function AddMaterial({ batch, modules, onClose }: { batch: BatchDetail; modules: MaterialsResult['modules']; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [moduleId, setModuleId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [batchIds, setBatchIds] = useState<string[]>([batch.id]);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const others = useQuery({ queryKey: ['material-batches', batch.id], queryFn: () => get<{ id: string; name: string; branch: string }[]>('/materials/batches', { batchId: batch.id }) });
  const sessions = useQuery({ queryKey: ['batch-sessions', batch.id], queryFn: () => get<SessionRow[]>(`/batches/${batch.id}/sessions`) });
  const save = useMutation({
    mutationFn: () => post('/materials', {
      title, batchIds, ...(moduleId ? { moduleId } : {}), ...(sessionId ? { sessionId } : {}),
      ...(kind === 'link' ? { url } : file ? { fileId: file.id } : {}),
    }),
    onSuccess: () => { toast('Material added. Students have been told.'); void qc.invalidateQueries({ queryKey: ['materials'] }); onClose(); },
    onError: (e) => { if (e instanceof ApiError) setErrors(e.fieldErrors); toast((e as Error).message, 'bad'); },
  });
  const pick = async (f?: File) => {
    if (!f) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const r = await upload<{ id: string; name: string }>('/materials/upload', fd);
      setFile(r);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    } catch (e) { toast((e as Error).message, 'bad'); } finally { setUploading(false); }
  };
  const past = (sessions.data ?? []).filter((s) => s.status !== 'CANCELLED');
  return (
    <Modal open onClose={onClose} title="Add material" size="lg" footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button loading={save.isPending} disabled={uploading || (kind === 'file' ? !file : !url) || !title.trim()} onClick={() => save.mutate()}>Add material</Button>
    </>}>
      <div className="grid gap-4">
        <Tabs value={kind} onChange={setKind} tabs={[{ id: 'file', label: 'Upload a file' }, { id: 'link', label: 'Add a link' }]} />
        {kind === 'file' ? (
          <div>
            <label htmlFor="mat-file" className="mb-1 block text-[14px] font-semibold">File</label>
            <input id="mat-file" type="file" onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-[14px] file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:font-semibold" />
            <p className="mt-1 text-[12.5px] text-muted">{uploading ? 'Uploading…' : file ? `${file.name} uploaded` : 'PDF, slides, documents, images, zip or video.'}</p>
          </div>
        ) : (
          <Input label="Link" type="url" placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} error={errors.url} required />
        )}
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={errors.title} required maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Course module" value={moduleId} onChange={(e) => setModuleId(e.target.value)} placeholder="Not linked to a module" options={modules.map((m) => ({ value: m.id, label: `${m.position}. ${m.title}` }))} />
          <Select label="Class" value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="Whole batch" options={past.map((s) => ({ value: s.id, label: `Class ${s.position} · ${formatDate(s.startsAt)}` }))} />
        </div>
        {(others.data?.length ?? 0) > 1 && (
          <fieldset>
            <legend className="mb-1 text-[14px] font-semibold">Share with batches</legend>
            <div className="grid gap-1.5">
              {others.data!.map((b) => (
                <Checkbox key={b.id} label={<span>{b.name} <Badge dot={false}>{b.branch}</Badge></span>} checked={batchIds.includes(b.id)} disabled={b.id === batch.id}
                  onChange={(e) => setBatchIds((x) => (e.target.checked ? [...x, b.id] : x.filter((y) => y !== b.id)))} />
              ))}
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
