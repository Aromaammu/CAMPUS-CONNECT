import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SETTING_GROUPS, SETTING_LABELS, SETTINGS_DEFAULTS, SettingKey } from '@cc/shared';
import { useEffect, useState } from 'react';
import { Button, Card, Checkbox, ErrorBox, Input, PageHeader, Spinner, Tabs, useToast } from '@/components/ui';
import { ApiError, get, put } from '@/lib/api';
import { HolidaysTab } from '../org/BranchDetailPage';

type Values = Record<string, string | number | boolean>;

export function SettingsPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: () => get<Values>('/settings') });
  const [tab, setTab] = useState<string>(SETTING_GROUPS[0].title);
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setValues(q.data); }, [q.data]);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  const group = SETTING_GROUPS.find((g) => g.title === tab);
  const save = async () => {
    if (!group) return;
    setBusy(true); setErrors({});
    try {
      const body = Object.fromEntries(group.keys.map((k) => [k, values[k]]));
      const r = await put<Values>('/settings', body);
      setValues(r); qc.setQueryData(['settings'], r); qc.invalidateQueries({ queryKey: ['brand'] });
      toast('Settings saved');
    } catch (e) {
      if (e instanceof ApiError) setErrors(e.fieldErrors);
      toast((e as Error).message, 'bad');
    } finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader title="Settings" subtitle="Rules and limits used across every branch" />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[...SETTING_GROUPS.map((g) => ({ id: g.title, label: g.title })), { id: 'Holidays', label: 'Holidays' }]} />
      {tab === 'Holidays' ? <HolidaysTab branchId={null} manage /> : group && (
        <Card title={group.title}>
          <div className="grid gap-4 sm:grid-cols-2">
            {group.keys.map((k: SettingKey) => {
              const def = SETTINGS_DEFAULTS[k];
              const label = SETTING_LABELS[k] ?? k;
              if (typeof def === 'boolean') {
                return <Checkbox key={k} className="sm:col-span-2" label={label} checked={!!values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.checked }))} />;
              }
              const isColor = k.endsWith('.primary') || k.endsWith('.accent');
              return (
                <Input key={k} label={label} type={typeof def === 'number' ? 'number' : 'text'} step="any"
                  value={String(values[k] ?? '')} error={errors[k]}
                  help={`Default: ${String(def)}`}
                  onChange={(e) => setValues((v) => ({ ...v, [k]: typeof def === 'number' ? e.target.value : e.target.value }))}
                  style={isColor ? { borderLeft: `14px solid ${values[k]}` } : undefined} />
              );
            })}
          </div>
          <div className="mt-5"><Button onClick={save} loading={busy}>Save {group.title.toLowerCase()}</Button></div>
        </Card>
      )}
    </>
  );
}
