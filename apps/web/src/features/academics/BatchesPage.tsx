import { useQuery } from '@tanstack/react-query';
import { BATCH_MODES, BATCH_STATUS, formatDateTime, formatDays, formatHHMM } from '@cc/shared';
import { Layers, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, ButtonLink, Card, Empty, ErrorBox, PageHeader, SearchInput, Select, Spinner, StatusBadge } from '@/components/ui';
import { BranchSelect, FilterBar, useDebounced } from '@/components/data';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BatchRow, mainTeacher } from './types';

export function BatchesPage({ mine = false }: { mine?: boolean }) {
  const { can, user } = useAuth();
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [mode, setMode] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useQuery({ queryKey: ['batches', mine, branchId, status, mode, dq], queryFn: () => get<BatchRow[]>('/batches', { mine: mine ? '1' : '', branchId, status, mode, q: dq }) });
  const base = mine ? '/teach/batches' : '/batches';
  return (
    <>
      <PageHeader title={mine ? 'My batches' : 'Batches'} subtitle={mine ? 'Every batch you teach, in every branch' : 'Classes running in your branches'}
        actions={!mine && can('batches.manage') && <ButtonLink to="/batches/new" variant="primary" icon={<Plus className="h-4 w-4" />}>New batch</ButtonLink>} />
      <FilterBar>
        <SearchInput value={q} onChange={setQ} placeholder="Search batch or course" className="self-end" />
        {!mine && <BranchSelect allowAll={user?.branchIds === null || (user?.branchIds?.length ?? 0) > 1} perm="batches.view" value={branchId} onChange={setBranchId} />}
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={Object.entries(BATCH_STATUS).map(([value, label]) => ({ value, label }))} />
        <Select label="Class type" value={mode} onChange={(e) => setMode(e.target.value)} placeholder="All" options={Object.entries(BATCH_MODES).map(([value, label]) => ({ value, label }))} />
      </FilterBar>
      {list.isLoading ? <Spinner /> : list.error ? <ErrorBox error={list.error} retry={list.refetch} /> : !list.data?.length ? <Card><Empty title="No batches found" icon={<Layers className="h-8 w-8" />} /></Card> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.data.map((b) => (
            <Link key={b.id} to={`${base}/${b.id}`} className="card flex flex-col gap-2 p-4 transition-colors hover:border-brand/50">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-muted">{b.branch.code} · {b.course.name}</span>
                <span className="flex gap-1.5"><Badge tone="brand" dot={false}>{BATCH_MODES[b.mode]}</Badge><StatusBadge status={b.status} labels={BATCH_STATUS} /></span>
              </div>
              <h2 className="text-[17px] font-bold">{b.name}</h2>
              <p className="text-[14px] text-muted">{formatDays(b.days)} · {formatHHMM(b.startTime)}–{formatHHMM(b.endTime)}{b.room ? ` · ${b.room.name}` : ''}</p>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                <span>{mainTeacher(b)?.user.name ?? 'No teacher'}</span>
                <span className="tabular text-muted">{b._count.enrolments}/{b.capacity} students</span>
              </div>
              {b.nextSession && <p className="text-[13px] font-semibold text-accent">{b.nextSession.status === 'LIVE' ? 'Live now' : `Next class ${formatDateTime(b.nextSession.startsAt)}`}</p>}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
