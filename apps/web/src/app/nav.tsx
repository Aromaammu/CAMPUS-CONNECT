import { Permission, SessionUser, UserKind, can } from '@cc/shared';
import {
  LayoutDashboard, Building2, Users, GraduationCap, BookOpen, CalendarDays, Layers, Wallet, MessageSquare, LifeBuoy,
  BarChart3, Settings, ScrollText, ShieldCheck, Video, ClipboardCheck, FileText, Megaphone, Radio, Inbox, UserCog, Network, FolderKanban, Star, Receipt,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  kinds?: UserKind[];
  perms?: Permission[];
  /** Only shown when the user holds the permission without branch restriction (admins). */
  global?: boolean;
  /** Built in a later phase: hidden until the route exists. */
  hidden?: boolean;
}
export interface NavGroup { title: string; items: NavItem[] }

const STAFF: UserKind[] = ['SUPER_ADMIN', 'ADMIN', 'EMPLOYEE'];

export const NAV: NavGroup[] = [
  {
    title: '',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/messages', label: 'Messages', icon: MessageSquare, hidden: true },
      { to: '/timetable', label: 'Timetable', icon: CalendarDays, hidden: true },
      { to: '/announcements/inbox', label: 'Announcements', icon: Megaphone, hidden: true },
    ],
  },
  {
    title: 'My learning',
    items: [
      { to: '/learn/courses', label: 'My courses', icon: BookOpen, kinds: ['STUDENT'], hidden: true },
      { to: '/learn/attendance', label: 'Attendance', icon: ClipboardCheck, kinds: ['STUDENT'], hidden: true },
      { to: '/learn/performance', label: 'Performance & feedback', icon: Star, kinds: ['STUDENT'], hidden: true },
      { to: '/learn/payments', label: 'Payments & dues', icon: Receipt, kinds: ['STUDENT'], hidden: true },
      { to: '/learn/projects', label: 'Final project', icon: FolderKanban, kinds: ['STUDENT'], hidden: true },
      { to: '/helpdesk', label: 'Help desk', icon: LifeBuoy, kinds: ['STUDENT'], hidden: true },
    ],
  },
  {
    title: 'Teaching',
    items: [
      { to: '/teach/batches', label: 'My batches', icon: Video, kinds: ['EMPLOYEE'], perms: ['sessions.teach'], hidden: true },
      { to: '/teach/attendance-requests', label: 'Attendance requests', icon: ClipboardCheck, kinds: ['EMPLOYEE'], perms: ['sessions.teach', 'attendance.oversee'], hidden: true },
      { to: '/teach/projects', label: 'Project reviews', icon: FolderKanban, kinds: ['EMPLOYEE'], perms: ['projects.review'], hidden: true },
      { to: '/teach/materials', label: 'Materials', icon: FileText, kinds: ['EMPLOYEE'], perms: ['materials.manage'], hidden: true },
      { to: '/teach/feedback', label: 'Feedback', icon: Star, kinds: ['EMPLOYEE'], perms: ['sessions.teach'], hidden: true },
      { to: '/meetings', label: 'Staff meetings', icon: Radio, kinds: STAFF, perms: ['meetings.host'], hidden: true },
    ],
  },
  {
    title: 'Monitoring',
    items: [
      { to: '/monitor', label: 'Network dashboard', icon: BarChart3, perms: ['reports.view'], global: true, hidden: true },
      { to: '/monitor/live', label: 'Live now', icon: Radio, perms: ['reports.view'], global: true, hidden: true },
      { to: '/reports', label: 'Reports', icon: FileText, perms: ['reports.view'], hidden: true },
    ],
  },
  {
    title: 'Academics',
    items: [
      { to: '/courses', label: 'Courses', icon: BookOpen, perms: ['courses.view', 'courses.manage', 'courses.request'], hidden: true },
      { to: '/course-requests', label: 'Course requests', icon: Inbox, perms: ['courses.decide', 'courses.request'], hidden: true },
      { to: '/batches', label: 'Batches', icon: Layers, perms: ['batches.view', 'batches.manage'], hidden: true },
      { to: '/attendance', label: 'Attendance', icon: ClipboardCheck, perms: ['attendance.oversee'], hidden: true },
      { to: '/project-approvals', label: 'Project approvals', icon: FolderKanban, perms: ['projects.approve'], hidden: true },
      { to: '/recordings', label: 'Recordings', icon: Video, perms: ['recordings.manage'], hidden: true },
    ],
  },
  {
    title: 'People',
    items: [
      { to: '/students', label: 'Students', icon: GraduationCap, perms: ['students.view'], hidden: true },
      { to: '/employees', label: 'Employees', icon: Users, perms: ['employees.view'], hidden: true },
      { to: '/designations', label: 'Departments & designations', icon: Network, perms: ['org.manage'], hidden: true },
    ],
  },
  {
    title: 'Accounts',
    items: [
      { to: '/accounts', label: 'Accounts dashboard', icon: Wallet, perms: ['accounts.view'], hidden: true },
      { to: '/accounts/dues', label: 'Dues & reminders', icon: Receipt, perms: ['accounts.view'], hidden: true },
      { to: '/accounts/receipts', label: 'Receipts', icon: FileText, perms: ['accounts.view'], hidden: true },
      { to: '/accounts/day-close', label: 'Day close', icon: ClipboardCheck, perms: ['accounts.view'], hidden: true },
      { to: '/accounts/fees', label: 'Course & branch fees', icon: Wallet, perms: ['accounts.view', 'fees.manage'], hidden: true },
      { to: '/accounts/approvals', label: 'Approvals', icon: ShieldCheck, perms: ['accounts.approve'], hidden: true },
      { to: '/accounts/reports', label: 'Collections & sales', icon: BarChart3, perms: ['accounts.view'], hidden: true },
    ],
  },
  {
    title: 'Communication',
    items: [
      { to: '/announcements', label: 'Send announcements', icon: Megaphone, perms: ['announcements.send'], hidden: true },
      { to: '/moderation', label: 'Chat moderation', icon: ShieldCheck, perms: ['moderation.review'], hidden: true },
      { to: '/helpdesk', label: 'Help desk', icon: LifeBuoy, kinds: STAFF, perms: ['helpdesk.handle'], hidden: true },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { to: '/branches', label: 'Branches', icon: Building2, perms: ['branch.view', 'branches.create'], hidden: true },
      { to: '/admins', label: 'Admins & modules', icon: UserCog, kinds: ['SUPER_ADMIN'], hidden: true },
      { to: '/settings', label: 'Settings', icon: Settings, perms: ['settings.manage'], hidden: true },
      { to: '/audit', label: 'Audit log', icon: ScrollText, perms: ['audit.view'], hidden: true },
    ],
  },
];

export function visibleNav(user: SessionUser, built: Set<string>): NavGroup[] {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => {
      if (i.hidden && !built.has(i.to)) return false;
      if (i.kinds && !i.kinds.includes(user.kind)) return false;
      if (i.perms) {
        if (!i.perms.some((p) => can(user, p))) return false;
        if (i.global && user.kind === 'EMPLOYEE') return false;
      }
      return true;
    }),
  })).filter((g) => g.items.length > 0);
}
