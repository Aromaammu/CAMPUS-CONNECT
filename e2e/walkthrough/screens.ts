/** Every built screen, per role. Each phase appends its screens. */
export interface Stop { path: string; name: string; expect?: string | RegExp }
export interface Tour { role: string; email: string; stops: Stop[] }

export const TOURS: Tour[] = [
  { role: 'super-admin', email: 'director@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/profile', name: 'Profile', expect: 'My profile' },
    { path: '/branches', name: 'Branches', expect: 'Branches' }, { path: '/admins', name: 'Admins', expect: 'Admins & modules' },
    { path: '/designations', name: 'Designations', expect: 'Departments & designations' }, { path: '/employees', name: 'Employees', expect: 'Employees' },
    { path: '/students', name: 'Students', expect: 'Students' }, { path: '/settings', name: 'Settings', expect: 'Settings' }, { path: '/audit', name: 'Audit log', expect: 'Audit log' },
    { path: '/courses', name: 'Courses', expect: 'Courses' }, { path: '/course-requests', name: 'Course requests', expect: 'Course requests' },
    { path: '/batches', name: 'Batches', expect: 'Batches' }, { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
    { path: '/attendance', name: 'Attendance overview', expect: 'Attendance' }, { path: '/recordings', name: 'Recordings', expect: 'Recordings' },
    { path: '/announcements', name: 'Send announcements', expect: 'Send announcements' }, { path: '/moderation', name: 'Chat moderation', expect: 'Chat moderation' },
    { path: '/messages', name: 'Messages', expect: 'Messages' },
  ] },
  { role: 'branch-admin', email: 'kochi.admin@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/branches', name: 'Branches', expect: 'Branches' },
    { path: '/employees', name: 'Employees', expect: 'Employees' }, { path: '/students', name: 'Students', expect: 'Students' },
    { path: '/designations', name: 'Designations', expect: 'Departments & designations' },
    { path: '/courses', name: 'Courses', expect: 'Courses' }, { path: '/batches', name: 'Batches', expect: 'Batches' }, { path: '/batches/new', name: 'New batch', expect: 'New batch' },
    { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
    { path: '/attendance', name: 'Attendance overview', expect: 'Attendance' }, { path: '/teach/attendance-requests', name: 'Attendance requests', expect: 'Attendance requests' },
    { path: '/recordings', name: 'Recordings', expect: 'Recordings' }, { path: '/project-approvals', name: 'Project approvals', expect: 'Project approvals' },
  ] },
  { role: 'teacher', email: 'anita.trainer@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/teach/batches', name: 'My batches', expect: 'My batches' }, { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
    { path: '/teach/attendance-requests', name: 'Attendance requests', expect: 'Attendance requests' },
    { path: '/teach/projects', name: 'Project reviews', expect: 'Project reviews' }, { path: '/teach/feedback', name: 'Feedback', expect: 'Feedback' },
    { path: '/teach/materials', name: 'Materials', expect: 'Materials' },
    { path: '/messages', name: 'Messages', expect: 'Messages' }, { path: '/meetings', name: 'Staff meetings', expect: 'Staff meetings' },
  ] },
  { role: 'head-of-accounts', email: 'accounts@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/accounts', name: 'Accounts', expect: 'Accounts' },
    { path: '/accounts/dues', name: 'Dues', expect: 'Dues & reminders' }, { path: '/accounts/receipts', name: 'Receipts', expect: 'Receipts' },
    { path: '/accounts/approvals', name: 'Approvals', expect: 'Approvals' }, { path: '/accounts/reports', name: 'Reports', expect: 'Collections & sales' },
    { path: '/accounts/day-close', name: 'Day close', expect: 'Day close' }, { path: '/accounts/fees', name: 'Fees', expect: 'Course & branch fees' },
  ] },
  { role: 'student', email: 'arjun.student@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/learn/courses', name: 'My courses', expect: 'My courses' }, { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
    { path: '/learn/attendance', name: 'Attendance', expect: 'Attendance' },
    { path: '/learn/performance', name: 'Performance', expect: 'Performance & feedback' }, { path: '/learn/projects', name: 'Final project', expect: 'Final project' },
    { path: '/messages', name: 'Messages', expect: 'Messages' }, { path: '/announcements/inbox', name: 'Announcements', expect: 'Announcements' },
    { path: '/learn/payments', name: 'Payments', expect: 'Payments & dues' },
  ] },
];

export const PUBLIC_STOPS: Stop[] = [
  { path: '/login', name: 'Login', expect: 'Log in' },
  { path: '/forgot-password', name: 'Forgot password', expect: 'Forgot your password?' },
  { path: '/privacy', name: 'Privacy Policy', expect: 'Privacy Policy' },
  { path: '/terms', name: 'Terms', expect: 'Terms of Use' },
];
