import { ClipboardCheck } from 'lucide-react';
import { ButtonLink } from '@/components/ui';
import { SESSION_ACTIONS } from '../academics/batchTabs';

/** Phase 4: an "Attendance" button on class rows for the teacher and branch staff, once the class has started. */
SESSION_ACTIONS.push(({ batch, session }) => {
  if (batch.viewerRole === 'student' || session.status === 'CANCELLED') return null;
  if (!batch.isTeacher && !batch.canTeach) return null;
  if (Date.now() < new Date(session.startsAt).getTime() - 15 * 60_000) return null;
  return <ButtonLink to={`/sessions/${session.id}`} size="sm" variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>Attendance</ButtonLink>;
});
