/**
 * Single source of truth for permissions (CLAUDE.md §6.2).
 *
 * - SUPER_ADMIN: every permission, every branch.
 * - ADMIN: every permission whose `module` the Super Admin granted them, in every branch.
 * - EMPLOYEE: the permissions of their designation (+ extras − removed), only in their branches.
 * - STUDENT: no staff permissions; student endpoints check ownership instead.
 */

export const MODULES = {
  branches: { label: 'Branches', description: 'Create, edit and close branches; assign Branch Admins' },
  academics: { label: 'Academics', description: 'Course catalogue, course requests, all batches, recordings' },
  people: { label: 'People', description: 'All employees, departments, designations and students' },
  accounts: { label: 'Accounts', description: 'Fees, payments, dues and collections (Head of Accounts)' },
  monitoring: { label: 'Monitoring', description: 'Branch performance dashboards and reports' },
  communication: { label: 'Communication', description: 'Announcements and chat moderation' },
  helpdesk: { label: 'Help Desk', description: 'All help desk tickets and escalations' },
  settings: { label: 'Settings', description: 'Branding, rules, notification templates, holidays, audit log' },
} as const;
export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];

type PermDef = { module: ModuleKey; label: string; adminOnly?: boolean };

export const PERMISSIONS = {
  // Branches
  'branch.view': { module: 'branches', label: 'See the branch dashboard' },
  'branch.manage': { module: 'branches', label: 'Edit branch details, rooms and branch holidays' },
  'branches.create': { module: 'branches', label: 'Create and close branches', adminOnly: true },
  // People
  'org.manage': { module: 'people', label: 'Manage departments and designations' },
  'employees.view': { module: 'people', label: 'See employees' },
  'employees.manage': { module: 'people', label: 'Add and edit employees' },
  'students.view': { module: 'people', label: 'See students' },
  'students.manage': { module: 'people', label: 'Add and edit students' },
  // Academics
  'courses.view': { module: 'academics', label: 'See the course catalogue' },
  'courses.manage': { module: 'academics', label: 'Edit the course catalogue', adminOnly: true },
  'courses.request': { module: 'academics', label: 'Request new courses for the branch' },
  'courses.decide': { module: 'academics', label: 'Approve or reject course requests', adminOnly: true },
  'batches.view': { module: 'academics', label: 'See batches and timetable' },
  'batches.manage': { module: 'academics', label: 'Create batches, change sessions' },
  'enrolments.manage': { module: 'academics', label: 'Enrol, move, hold and drop students' },
  'sessions.teach': { module: 'academics', label: 'Teach assigned batches' },
  'attendance.oversee': { module: 'academics', label: 'Change any attendance and handle escalations' },
  'materials.manage': { module: 'academics', label: 'Upload notes and materials' },
  'recordings.manage': { module: 'academics', label: 'Rename, hide and delete recordings' },
  'projects.review': { module: 'academics', label: 'Review final projects (teacher)' },
  'projects.approve': { module: 'academics', label: 'Give final project approval (branch)' },
  // Accounts
  'accounts.view': { module: 'accounts', label: 'See fees, payments and dues' },
  'accounts.record': { module: 'accounts', label: 'Record payments and fee plans' },
  'fees.manage': { module: 'accounts', label: 'Set branch batch prices' },
  'accounts.approve': { module: 'accounts', label: 'Approve voids, big discounts; lock prices', adminOnly: true },
  // Communication
  'announcements.send': { module: 'communication', label: 'Send announcements' },
  'messaging.groups': { module: 'communication', label: 'Create staff groups' },
  'moderation.review': { module: 'communication', label: 'Review and hide chat messages' },
  'meetings.host': { module: 'communication', label: 'Start and schedule staff meetings' },
  // Help desk
  'helpdesk.handle': { module: 'helpdesk', label: 'Answer help desk tickets' },
  // Monitoring
  'reports.view': { module: 'monitoring', label: 'See performance dashboards and reports' },
  // Settings
  'settings.manage': { module: 'settings', label: 'Change settings and holidays', adminOnly: true },
  'audit.view': { module: 'settings', label: 'See the audit log', adminOnly: true },
} as const satisfies Record<string, PermDef>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];
export const BRANCH_PERMISSIONS = PERMISSION_KEYS.filter((p) => !(PERMISSIONS[p] as PermDef).adminOnly);

export type UserKind = 'SUPER_ADMIN' | 'ADMIN' | 'EMPLOYEE' | 'STUDENT';

/** Designation templates created for every new branch. */
export const DESIGNATION_TEMPLATES: { name: string; department: string; permissions: Permission[] }[] = [
  { name: 'Branch Admin', department: 'Administration', permissions: [...BRANCH_PERMISSIONS] },
  {
    name: 'Senior Trainer',
    department: 'Academics',
    permissions: ['sessions.teach', 'materials.manage', 'projects.review', 'batches.view', 'students.view', 'courses.view', 'meetings.host', 'attendance.oversee', 'messaging.groups'],
  },
  {
    name: 'Trainer',
    department: 'Academics',
    permissions: ['sessions.teach', 'materials.manage', 'projects.review', 'batches.view', 'students.view', 'courses.view', 'meetings.host'],
  },
  { name: 'Accountant', department: 'Accounts', permissions: ['accounts.view', 'accounts.record', 'students.view', 'batches.view'] },
  {
    name: 'Counsellor',
    department: 'Admissions',
    permissions: ['students.view', 'students.manage', 'enrolments.manage', 'batches.view', 'courses.view', 'helpdesk.handle'],
  },
  { name: 'Front Office', department: 'Administration', permissions: ['students.view', 'helpdesk.handle', 'batches.view'] },
];
export const DEPARTMENT_TEMPLATES = ['Administration', 'Academics', 'Accounts', 'Admissions'];

/** What a signed-in user carries (returned by /auth/me and used for menus). */
export interface SessionUser {
  id: string;
  kind: UserKind;
  name: string;
  email: string | null;
  mobile: string | null;
  mustChangePassword: boolean;
  modules: ModuleKey[];
  /** Effective permissions (for EMPLOYEE); all for SUPER_ADMIN; module-derived for ADMIN. */
  permissions: Permission[];
  /** Branch ids the user may act in. `null` = all branches. */
  branchIds: string[] | null;
  employeeId: string | null;
  studentId: string | null;
  designation: string | null;
  homeBranchId: string | null;
}

export function permissionsForModules(modules: ModuleKey[]): Permission[] {
  return PERMISSION_KEYS.filter((p) => modules.includes(PERMISSIONS[p].module));
}

/** Pure check used by both API guard and web menus. */
export function can(user: Pick<SessionUser, 'kind' | 'permissions' | 'branchIds'>, perm: Permission, branchId?: string | null): boolean {
  if (user.kind === 'SUPER_ADMIN') return true;
  if (user.kind === 'STUDENT') return false;
  if (!user.permissions.includes(perm)) return false;
  if (branchId == null || user.branchIds === null) return true;
  return user.branchIds.includes(branchId);
}
