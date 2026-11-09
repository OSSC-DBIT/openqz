import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BarChart3, BookOpen, ClipboardList, History, KeyRound, LayoutDashboard, Layers, Library, ShieldAlert, Upload, Users } from 'lucide-react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouterProvider } from 'react-router';
import { ApiError } from './api/client';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { RequireRole } from './auth/RequireRole';
import './index.css';
import { AppShell, type NavItem } from './layouts/AppShell';
import { StudentShell } from './layouts/StudentShell';
import type { ComponentType } from 'react';
import ChangePasswordPage from './pages/ChangePasswordPage';
import LoginPage from './pages/LoginPage';
import NotFound from './pages/NotFound';
import RouteError from './pages/RouteError';
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordResetPages';
import StudentHome from './pages/student/StudentHome';
import PlayerPage from './student/PlayerPage';
import JoinPage from './student/JoinPage';
import ReviewPage from './student/ReviewPage';

/**
 * Staff screens load on demand (route-level code splitting), so students
 * download only the sign-in, home, join and player code.
 */
function page<M extends Record<string, unknown>>(load: () => Promise<M>, name = 'default') {
  return async () => ({ Component: (await load())[name] as ComponentType });
}

const adminNav: NavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/sections', label: 'Sections', icon: Layers },
  { to: '/admin/subjects', label: 'Subjects', icon: BookOpen },
  { to: '/admin/assignments', label: 'Faculty mapping', icon: ClipboardList },
  { to: '/admin/imports', label: 'Imports', icon: Upload },
  { to: '/faculty/library', label: 'Library', icon: Library },
  { to: '/faculty/reports', label: 'Reports', icon: BarChart3 },
  { to: '/admin/integrity', label: 'Integrity log', icon: ShieldAlert },
  { to: '/admin/audit', label: 'Audit log', icon: History },
  { to: '/account/password', label: 'Password', icon: KeyRound },
];
const facultyNav: NavItem[] = [
  { to: '/faculty', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/faculty/library', label: 'Library', icon: Library },
  { to: '/faculty/reports', label: 'Reports', icon: BarChart3 },
  { to: '/faculty/integrity', label: 'Integrity log', icon: ShieldAlert },
  { to: '/account/password', label: 'Password', icon: KeyRound },
];
const clubNav: NavItem[] = [
  { to: '/faculty', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/faculty/library', label: 'Library', icon: Library },
  { to: '/faculty/reports', label: 'Rooms & reports', icon: BarChart3 },
  { to: '/account/password', label: 'Password', icon: KeyRound },
];

/** Admins reach the faculty tools with their own navigation. */
function FacultyShell() {
  const { user } = useAuth();
  const nav = user?.role === 'admin' ? adminNav : user?.role === 'club' ? clubNav : facultyNav;
  return <AppShell nav={nav} action={{ to: '/faculty/library?create=1', label: 'Create' }} />;
}

const router = createBrowserRouter([
  {
    // Every page shares one friendly error screen (and a one-time reload after an update).
    errorElement: <RouteError />,
    children: [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '/login', element: <LoginPage /> },
    { path: '/change-password', element: <ChangePasswordPage /> },
    { path: '/forgot-password', element: <ForgotPasswordPage /> },
    { path: '/reset-password', element: <ResetPasswordPage /> },
    { path: '/account/password', element: <ChangePasswordPage /> },
    {
      path: '/admin',
      element: (
        <RequireRole roles={['admin']}>
          <AppShell nav={adminNav} />
        </RequireRole>
      ),
      children: [
        { index: true, lazy: page(() => import('./pages/admin/DashboardPage')) },
        { path: 'users', lazy: page(() => import('./pages/admin/UsersPage')) },
        { path: 'sections', lazy: page(() => import('./pages/admin/OrgPage'), 'SectionsPage') },
        { path: 'subjects', lazy: page(() => import('./pages/admin/OrgPage'), 'SubjectsPage') },
        { path: 'assignments', lazy: page(() => import('./pages/admin/AssignmentsPage')) },
        { path: 'imports', lazy: page(() => import('./pages/admin/ImportsPage')) },
        { path: 'imports/:id', lazy: page(() => import('./pages/admin/ImportDetailPage')) },
        { path: 'integrity', lazy: page(() => import('./pages/admin/IntegrityPage')) },
        { path: 'audit', lazy: page(() => import('./pages/admin/AuditPage')) },
      ],
    },
    {
      path: '/faculty',
      element: (
        <RequireRole roles={['faculty', 'admin', 'club']}>
          <FacultyShell />
        </RequireRole>
      ),
      children: [
        { index: true, lazy: page(() => import('./pages/faculty/FacultyHome')) },
        { path: 'library', lazy: page(() => import('./pages/faculty/LibraryPage')) },
        { path: 'reports', lazy: page(() => import('./pages/faculty/ReportsListPage')) },
        { path: 'reports/:id', lazy: page(() => import('./pages/faculty/ReportPage')) },
        { path: 'integrity', lazy: page(() => import('./pages/admin/IntegrityPage')) },
      ],
    },
    {
      // The editor is a full-screen workspace with its own top bar.
      path: '/faculty/activities/:id',
      element: (
        <RequireRole roles={['faculty', 'admin', 'club']}>
          <Outlet />
        </RequireRole>
      ),
      children: [{ index: true, lazy: page(() => import('./pages/faculty/ActivityEditorPage')) }],
    },
    {
      path: '/student',
      element: (
        <RequireRole roles={['student']}>
          <StudentShell />
        </RequireRole>
      ),
      children: [
        { index: true, element: <StudentHome /> },
        { path: 'review/:attemptId', element: <ReviewPage /> },
      ],
    },
    {
      path: '/join',
      element: (
        <RequireRole roles={['student']}>
          <JoinPage />
        </RequireRole>
      ),
    },
    {
      path: '/join/:code',
      element: (
        <RequireRole roles={['student']}>
          <JoinPage />
        </RequireRole>
      ),
    },
    {
      path: '/play/:attemptId',
      element: (
        <RequireRole roles={['student']}>
          <PlayerPage />
        </RequireRole>
      ),
    },
    { path: '*', element: <NotFound /> },
    ],
  },
]);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Installable PWA. Only in production builds so the Vite dev server is never cached.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
