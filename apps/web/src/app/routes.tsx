import type { ReactElement } from 'react';
import { BranchesPage } from '@/features/org/BranchesPage';
import { BranchDetailPage } from '@/features/org/BranchDetailPage';
import { DesignationsPage } from '@/features/org/DesignationsPage';
import { EmployeesPage } from '@/features/people/EmployeesPage';
import { StudentsPage } from '@/features/people/StudentsPage';
import { StudentDetailPage } from '@/features/people/StudentDetailPage';
import { AdminsPage } from '@/features/admin/AdminsPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { AuditPage } from '@/features/admin/AuditPage';

export interface AppRoute { path: string; element: ReactElement }

/** Pages inside the main layout. Each phase adds its routes here. */
export const APP_ROUTES: AppRoute[] = [
  { path: '/branches', element: <BranchesPage /> },
  { path: '/branches/:id', element: <BranchDetailPage /> },
  { path: '/designations', element: <DesignationsPage /> },
  { path: '/employees', element: <EmployeesPage /> },
  { path: '/students', element: <StudentsPage /> },
  { path: '/students/:id', element: <StudentDetailPage /> },
  { path: '/admins', element: <AdminsPage /> },
  { path: '/settings', element: <SettingsPage /> },
  { path: '/audit', element: <AuditPage /> },
];

/** Pages that take the whole screen (live class room, recording player). */
export const FULLSCREEN_ROUTES: AppRoute[] = [];
