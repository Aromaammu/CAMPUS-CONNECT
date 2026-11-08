import { Card } from '@/components/ui';

/** Role dashboards are filled in as each phase lands (Phase 5 student/teacher, Phase 9 admin/branch). */
export function DashboardWidgets() {
  return (
    <Card>
      <p className="text-[14.5px] text-muted">Your dashboard will show today's classes, attendance, dues and messages here.</p>
    </Card>
  );
}
