import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Button, Empty, Spinner } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { FirstLoginPage, ForgotPasswordPage, LoginPage, ResetPasswordPage } from '@/features/auth/AuthPages';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { PrivacyPage, TermsPage } from '@/features/legal/LegalPages';
import { MailboxPage } from '@/features/dev/MailboxPage';
import { Shell } from './Shell';
import { APP_ROUTES, FULLSCREEN_ROUTES } from './routes';
import { Link } from 'react-router-dom';

function RequireAuth() {
  const { user, loading, me } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (user.mustChangePassword || me?.needsConsent) return <Navigate to="/first-login" replace />;
  return <Outlet />;
}

function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <Spinner />;
  if (user) return <Navigate to={user.mustChangePassword ? '/first-login' : '/'} replace />;
  return <Outlet />;
}

function FirstLoginGate() {
  const { user, loading, me } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword && !me?.needsConsent) return <Navigate to="/" replace />;
  return <FirstLoginPage />;
}

function NotFound() {
  return (
    <Empty title="We couldn't find that page" action={<Link to="/"><Button variant="secondary">Go to dashboard</Button></Link>}>
      The link may be old, or you may not have access to it.
    </Empty>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Route>
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/first-login" element={<FirstLoginGate />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/dev/mailbox" element={<MailboxPage />} />
      <Route element={<RequireAuth />}>
        {FULLSCREEN_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
        <Route element={<Shell><Outlet /></Shell>}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          {APP_ROUTES.map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}
