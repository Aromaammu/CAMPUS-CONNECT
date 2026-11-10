import { Download } from 'lucide-react';
import { Button, Card, useToast } from '@/components/ui';
import { download } from '@/lib/api';
import type { StudentRow } from './StudentsPage';

/** Reports for staff on the student page (fees join in Phase 7). */
export function StudentDetailExtras({ student }: { student: StudentRow }) {
  const toast = useToast();
  const get = (kind: 'attendance' | 'performance') => void download(`/reports/students/${student.id}/${kind}.pdf`).catch((e) => toast((e as Error).message, 'bad'));
  return (
    <Card title="Reports" className="mt-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => get('attendance')}>Attendance report (PDF)</Button>
        <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => get('performance')}>Performance report (PDF)</Button>
      </div>
    </Card>
  );
}
