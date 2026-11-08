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
  ] },
  { role: 'branch-admin', email: 'kochi.admin@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/branches', name: 'Branches', expect: 'Branches' },
    { path: '/employees', name: 'Employees', expect: 'Employees' }, { path: '/students', name: 'Students', expect: 'Students' },
    { path: '/designations', name: 'Designations', expect: 'Departments & designations' },
    { path: '/courses', name: 'Courses', expect: 'Courses' }, { path: '/batches', name: 'Batches', expect: 'Batches' }, { path: '/batches/new', name: 'New batch', expect: 'New batch' },
    { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
  ] },
  { role: 'teacher', email: 'anita.trainer@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/teach/batches', name: 'My batches', expect: 'My batches' }, { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
  ] },
  { role: 'head-of-accounts', email: 'accounts@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }] },
  { role: 'student', email: 'arjun.student@demo.cc', stops: [
    { path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/learn/courses', name: 'My courses', expect: 'My courses' }, { path: '/timetable', name: 'Timetable', expect: 'Timetable' },
  ] },
];

export const PUBLIC_STOPS: Stop[] = [
  { path: '/login', name: 'Login', expect: 'Log in' },
  { path: '/forgot-password', name: 'Forgot password', expect: 'Forgot your password?' },
  { path: '/privacy', name: 'Privacy Policy', expect: 'Privacy Policy' },
  { path: '/terms', name: 'Terms', expect: 'Terms of Use' },
];
