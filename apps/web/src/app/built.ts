/** Menu items whose screens exist. Each phase adds its routes here. */
export const BUILT_ROUTES = new Set<string>([
  '/',
  // Phase 1
  '/branches', '/designations', '/employees', '/students', '/admins', '/settings', '/audit',
  // Phase 2
  '/courses', '/course-requests', '/batches', '/teach/batches', '/timetable', '/learn/courses',
  // Phase 4
  '/learn/attendance', '/teach/attendance-requests', '/attendance', '/recordings',
  // Phase 5
  '/learn/performance', '/learn/projects', '/teach/projects', '/project-approvals', '/teach/feedback', '/teach/materials',
  // Phase 6
  '/messages', '/announcements', '/announcements/inbox', '/moderation', '/meetings',
]);
