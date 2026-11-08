import { Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/** Timetable links open the right batch page for each kind of user. */
export function BatchRedirect() {
  const { id } = useParams();
  const { user, can } = useAuth();
  if (user?.kind === 'STUDENT') return <Navigate to={`/learn/courses/${id}`} replace />;
  if (can('batches.view')) return <Navigate to={`/batches/${id}`} replace />;
  return <Navigate to={`/teach/batches/${id}`} replace />;
}
