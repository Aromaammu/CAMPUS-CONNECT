import { MODULES } from '@cc/shared';
import { Badge, Card, PageHeader } from '@/components/ui';
import { firstName, roleLabel, useUser } from '@/lib/auth';
import { DashboardWidgets } from './DashboardWidgets';

function greeting() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(new Date()));
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function DashboardPage() {
  const user = useUser();
  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName(user.name)}`} subtitle={roleLabel(user)} />
      <DashboardWidgets />
      {user.kind === 'ADMIN' && (
        <Card title="Your modules" className="mt-5">
          <p className="mb-3 text-[14.5px] text-muted">The Director has given you control of these modules across every branch.</p>
          <div className="flex flex-wrap gap-2">{user.modules.map((m) => <Badge key={m} tone="brand">{MODULES[m].label}</Badge>)}</div>
        </Card>
      )}
    </>
  );
}
