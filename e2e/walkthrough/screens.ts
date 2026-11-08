/** Every built screen, per role. Each phase appends its screens. */
export interface Stop { path: string; name: string; expect?: string | RegExp }
export interface Tour { role: string; email: string; stops: Stop[] }

export const TOURS: Tour[] = [
  { role: 'super-admin', email: 'director@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }, { path: '/profile', name: 'Profile', expect: 'My profile' }] },
  { role: 'branch-admin', email: 'kochi.admin@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }] },
  { role: 'teacher', email: 'anita.trainer@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }] },
  { role: 'head-of-accounts', email: 'accounts@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }] },
  { role: 'student', email: 'arjun.student@demo.cc', stops: [{ path: '/', name: 'Dashboard', expect: /Good/ }] },
];

export const PUBLIC_STOPS: Stop[] = [
  { path: '/login', name: 'Login', expect: 'Log in' },
  { path: '/forgot-password', name: 'Forgot password', expect: 'Forgot your password?' },
  { path: '/privacy', name: 'Privacy Policy', expect: 'Privacy Policy' },
  { path: '/terms', name: 'Terms', expect: 'Terms of Use' },
];
