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
import { CourseDetailPage, CoursesPage } from '@/features/academics/CoursesPage';
import { CourseRequestsPage } from '@/features/academics/CourseRequestsPage';
import { BatchesPage } from '@/features/academics/BatchesPage';
import { BatchFormPage } from '@/features/academics/BatchFormPage';
import { BatchDetailPage } from '@/features/academics/BatchDetailPage';
import { TimetablePage } from '@/features/academics/TimetablePage';
import { MyCoursesPage } from '@/features/learn/MyCoursesPage';
import { BatchRedirect } from '@/features/academics/BatchRedirect';
import { LivePage } from '@/features/live/LivePage';
import '@/features/live/register';
import '@/features/attendance/register';
import { SessionPage } from '@/features/attendance/SessionPage';
import { StudentAttendancePage } from '@/features/attendance/StudentAttendancePage';
import { RequestsPage } from '@/features/attendance/RequestsPage';
import { OverviewPage } from '@/features/attendance/OverviewPage';

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
  // Phase 2
  { path: '/courses', element: <CoursesPage /> },
  { path: '/courses/:id', element: <CourseDetailPage /> },
  { path: '/course-requests', element: <CourseRequestsPage /> },
  { path: '/batches', element: <BatchesPage /> },
  { path: '/batches/new', element: <BatchFormPage /> },
  { path: '/batches/:id', element: <BatchDetailPage /> },
  { path: '/teach/batches', element: <BatchesPage mine /> },
  { path: '/teach/batches/:id', element: <BatchDetailPage backTo="/teach/batches" backLabel="My batches" /> },
  { path: '/timetable', element: <TimetablePage /> },
  { path: '/timetable/batch/:id', element: <BatchRedirect /> },
  { path: '/learn/courses', element: <MyCoursesPage /> },
  { path: '/learn/courses/:id', element: <BatchDetailPage backTo="/learn/courses" backLabel="My courses" /> },
  // Phase 4
  { path: '/sessions/:id', element: <SessionPage /> },
  { path: '/learn/attendance', element: <StudentAttendancePage /> },
  { path: '/teach/attendance-requests', element: <RequestsPage /> },
  { path: '/attendance', element: <OverviewPage /> },
];

/** Pages that take the whole screen (live class room, recording player). */
export const FULLSCREEN_ROUTES: AppRoute[] = [
  // Phase 3
  { path: '/live/:sessionId', element: <LivePage /> },
];
