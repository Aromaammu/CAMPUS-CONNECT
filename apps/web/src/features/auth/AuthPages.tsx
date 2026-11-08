import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from '@cc/shared';
import { ReactNode, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { Button, Checkbox, Input, Notice, Tabs } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { firstName, useAuth } from '@/lib/auth';
import { useBrand } from '@/lib/brand';
import { Logo } from '@/app/Shell';

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  const brand = useBrand();
  return (
    <div className="grid min-h-full lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <div className="relative hidden overflow-hidden bg-[#0E3B47] text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2 font-display text-[19px] font-bold">
          <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden><rect width="32" height="32" rx="8" fill="#fff" fillOpacity=".12" /><path d="M9 20.5V11.5l7-3.5 7 3.5v9l-7 3.5z" fill="none" stroke="#F0A53A" strokeWidth="2.2" strokeLinejoin="round" /><circle cx="16" cy="16" r="2.6" fill="#fff" /></svg>
          {brand.name}
        </div>
        <div className="max-w-lg">
          <p className="font-display text-[34px] font-bold leading-tight">Every class, every branch, one place.</p>
          <p className="mt-4 text-[16px] text-white/75">Live classes with attendance taken for you, recordings for your batch, and your teachers one message away.</p>
          <ul className="mt-8 grid gap-3 text-[15px] text-white/85">
            {['Join live classes right here — no meeting links', 'See your timetable, attendance and fees', 'Message teachers and branch staff'].map((t) => (
              <li key={t} className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-[#F0A53A]" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="text-[13px] text-white/55">{brand.tagline}</p>
        <svg className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] opacity-[0.07]" viewBox="0 0 100 100" aria-hidden>
          <path d="M20 70V30l30-15 30 15v40L50 85z" fill="none" stroke="#fff" strokeWidth="3" />
        </svg>
      </div>
      <div className="flex flex-col justify-center py-10" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
        <div className="mx-auto w-full max-w-[420px]">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-[26px] font-bold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-[14px] text-muted">{footer}</div>}
          <p className="mt-10 text-[12.5px] text-muted"><Link className="hover:text-fg" to="/privacy">Privacy Policy</Link> · <Link className="hover:text-fg" to="/terms">Terms</Link></p>
        </div>
      </div>
    </div>
  );
}

function setServerErrors<T extends Record<string, unknown>>(e: unknown, setError: (k: never, v: { message: string }) => void, setTop: (m: string) => void) {
  if (e instanceof ApiError) {
    const keys = Object.keys(e.fieldErrors);
    keys.forEach((k) => setError(k as never, { message: e.fieldErrors[k] }));
    if (!keys.length) setTop(e.message);
  } else setTop('Something went wrong. Please try again.');
  return undefined as unknown as T;
}

export function LoginPage() {
  const [mode, setMode] = useState<'password' | 'otp'>('password');
  return (
    <AuthLayout title="Log in" subtitle="Use the email or mobile number your branch registered.">
      <Tabs className="mb-5" value={mode} onChange={setMode} tabs={[{ id: 'password', label: 'Password' }, { id: 'otp', label: 'SMS code' }]} />
      {mode === 'password' ? <PasswordLogin /> : <OtpLogin />}
    </AuthLayout>
  );
}

function PasswordLogin() {
  const { refetch } = useAuth();
  const nav = useNavigate();
  const [top, setTop] = useState('');
  const f = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const submit = f.handleSubmit(async (v) => {
    setTop('');
    try {
      await post('/auth/login', v);
      await refetch();
      nav('/', { replace: true });
    } catch (e) { setServerErrors(e, f.setError as never, setTop); }
  });
  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      {top && <Notice tone="bad">{top}</Notice>}
      <Input label="Email or mobile number" autoComplete="username" inputMode="email" {...f.register('identifier')} error={f.formState.errors.identifier?.message} />
      <Input label="Password" type="password" autoComplete="current-password" {...f.register('password')} error={f.formState.errors.password?.message} />
      <div className="flex justify-end -mt-1"><Link to="/forgot-password" className="text-[14px] font-semibold text-brand hover:underline">Forgot password?</Link></div>
      <Button type="submit" loading={f.formState.isSubmitting} className="w-full">Log in</Button>
    </form>
  );
}

function OtpLogin() {
  const { refetch } = useAuth();
  const nav = useNavigate();
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'bad' | 'ok'; text: string } | null>(null);
  const send = async () => {
    setBusy(true); setMsg(null);
    try { const r = await post<{ message: string }>('/auth/otp/request', { mobile }); setSent(true); setMsg({ tone: 'ok', text: r.message }); }
    catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const verify = async () => {
    setBusy(true); setMsg(null);
    try { await post('/auth/otp/verify', { mobile, code }); await refetch(); nav('/', { replace: true }); }
    catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); setBusy(false); }
  };
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (sent) void verify(); else void send(); }} noValidate>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <Input label="Mobile number" inputMode="tel" autoComplete="tel" placeholder="98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value)} disabled={sent} />
      {sent && <Input label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
      <Button type="submit" loading={busy} className="w-full">{sent ? 'Log in' : 'Send code'}</Button>
      {sent && <button type="button" className="text-[14px] font-semibold text-brand hover:underline" onClick={() => { setSent(false); setCode(''); setMsg(null); }}>Use a different number</button>}
    </form>
  );
}

export function ForgotPasswordPage() {
  const [done, setDone] = useState('');
  const [top, setTop] = useState('');
  const f = useForm<z.infer<typeof forgotPasswordSchema>>({ resolver: zodResolver(forgotPasswordSchema) });
  const submit = f.handleSubmit(async (v) => {
    try { const r = await post<{ message: string }>('/auth/forgot-password', v); setDone(r.message); } catch (e) { setServerErrors(e, f.setError as never, setTop); }
  });
  return (
    <AuthLayout title="Forgot your password?" subtitle="We'll send a reset link to your email, or by SMS if you have no email." footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to log in</Link>}>
      {done ? <Notice tone="ok">{done}</Notice> : (
        <form onSubmit={submit} className="grid gap-4" noValidate>
          {top && <Notice tone="bad">{top}</Notice>}
          <Input label="Email or mobile number" {...f.register('identifier')} error={f.formState.errors.identifier?.message} />
          <Button type="submit" loading={f.formState.isSubmitting} className="w-full">Send reset link</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [top, setTop] = useState('');
  const f = useForm<z.infer<typeof resetPasswordSchema>>({ resolver: zodResolver(resetPasswordSchema), defaultValues: { token: params.get('token') ?? '' } });
  const submit = f.handleSubmit(async (v) => {
    try { await post('/auth/reset-password', v); nav('/login?reset=1', { replace: true }); } catch (e) { setServerErrors(e, f.setError as never, setTop); }
  });
  return (
    <AuthLayout title="Set a new password" footer={<Link to="/login" className="font-semibold text-brand hover:underline">Back to log in</Link>}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {top && <Notice tone="bad">{top}</Notice>}
        <input type="hidden" {...f.register('token')} />
        <Input label="New password" type="password" autoComplete="new-password" help="At least 8 characters with letters and a number" {...f.register('newPassword')} error={f.formState.errors.newPassword?.message} />
        <Input label="Type it again" type="password" autoComplete="new-password" {...f.register('confirmPassword')} error={f.formState.errors.confirmPassword?.message} />
        <Button type="submit" loading={f.formState.isSubmitting} className="w-full">Save new password</Button>
      </form>
    </AuthLayout>
  );
}

/** First login: new password + Privacy/Terms consent (+ guardian consent for under-18s). */
export function FirstLoginPage() {
  const { me, refetch, logout } = useAuth();
  const nav = useNavigate();
  const [top, setTop] = useState('');
  const f = useForm<z.infer<typeof changePasswordSchema>>({ resolver: zodResolver(changePasswordSchema) });
  const submit = f.handleSubmit(async (v) => {
    try { await post('/auth/change-password', v); await refetch(); nav('/', { replace: true }); } catch (e) { setServerErrors(e, f.setError as never, setTop); }
  });
  return (
    <AuthLayout title={`Welcome, ${me ? firstName(me.user.name) : ''}`} subtitle="Before you start, set your own password." footer={<button type="button" className="font-semibold text-brand hover:underline" onClick={() => logout()}>Log out</button>}>
      <form onSubmit={submit} className="grid gap-4" noValidate>
        {top && <Notice tone="bad">{top}</Notice>}
        <Input label="New password" type="password" autoComplete="new-password" help="At least 8 characters with letters and a number" {...f.register('newPassword')} error={f.formState.errors.newPassword?.message} />
        <Input label="Type it again" type="password" autoComplete="new-password" {...f.register('confirmPassword')} error={f.formState.errors.confirmPassword?.message} />
        {me?.needsConsent && (
          <Checkbox
            {...f.register('consent')}
            error={f.formState.errors.consent?.message}
            label={<>I have read and agree to the <Link to="/privacy" target="_blank" className="font-semibold text-brand underline">Privacy Policy</Link> and <Link to="/terms" target="_blank" className="font-semibold text-brand underline">Terms</Link>, including that chats with staff may be reviewed for safety.</>}
          />
        )}
        {me?.needsConsent && me.isMinor && (
          <Checkbox {...f.register('guardianConsent')} error={f.formState.errors.guardianConsent?.message} label="My parent or guardian has read these and agrees to my use of this app (required for students under 18)." />
        )}
        <Button type="submit" loading={f.formState.isSubmitting} className="w-full">Save and continue</Button>
      </form>
    </AuthLayout>
  );
}
