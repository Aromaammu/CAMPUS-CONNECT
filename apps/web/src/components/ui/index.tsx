import { clsx } from 'clsx';
import { Loader2, X, ChevronLeft, ChevronRight, Search, Inbox, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import {
  ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, createContext, forwardRef,
  useCallback, useContext, useEffect, useId, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';

export { clsx };

// ───────── Buttons ─────────
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand/90 border border-transparent',
  accent: 'bg-accent text-white hover:bg-accent/90 border border-transparent dark:text-[#1b1405]',
  secondary: 'bg-surface text-fg border border-line hover:border-brand/50 hover:bg-surface-2',
  ghost: 'bg-transparent text-fg border border-transparent hover:bg-surface-2',
  danger: 'bg-bad text-white hover:bg-bad/90 border border-transparent dark:text-[#2a0d0d]',
};
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  loading?: boolean;
  icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, className, children, disabled, type = 'button', ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap',
        size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-4 py-2 text-[14.5px]',
        VARIANTS[variant], className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ to, variant = 'secondary', size = 'md', icon, children, className }: { to: string; variant?: Variant; size?: 'sm' | 'md'; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={clsx('inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors whitespace-nowrap', size === 'sm' ? 'px-2.5 py-1.5 text-[13px]' : 'px-4 py-2 text-[14.5px]', VARIANTS[variant], className)}>
      {icon}{children}
    </Link>
  );
}

// ───────── Form fields ─────────
export function Field({ label, error, help, children, htmlFor, required, className }: { label?: ReactNode; error?: string; help?: ReactNode; children: ReactNode; htmlFor?: string; required?: boolean; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      {label && <label className="label" htmlFor={htmlFor}>{label}{required && <span className="text-bad"> *</span>}</label>}
      {children}
      {error ? <p className="err" role="alert">{error}</p> : help ? <p className="help">{help}</p> : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode; error?: string; help?: ReactNode };
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, error, help, id, className, required, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={iid} required={required} className={className}>
      <input ref={ref} id={iid} className={clsx('input', error && 'border-bad')} aria-invalid={!!error} required={required} {...rest} />
    </Field>
  );
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: ReactNode; error?: string; help?: ReactNode };
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, error, help, id, className, required, rows = 3, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={iid} required={required} className={className}>
      <textarea ref={ref} id={iid} rows={rows} className={clsx('input', error && 'border-bad')} aria-invalid={!!error} required={required} {...rest} />
    </Field>
  );
});

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & { label?: ReactNode; error?: string; help?: ReactNode; options: { value: string; label: string }[]; placeholder?: string };
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, error, help, id, className, options, placeholder, required, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <Field label={label} error={error} help={help} htmlFor={iid} required={required} className={className}>
      <select ref={ref} id={iid} className={clsx('input pr-8', error && 'border-bad')} aria-invalid={!!error} required={required} {...rest}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; error?: string }>(function Checkbox({ label, error, id, className, ...rest }, ref) {
  const auto = useId();
  const iid = id ?? auto;
  return (
    <div className={className}>
      <label htmlFor={iid} className="flex items-start gap-2.5 text-[14.5px] cursor-pointer">
        <input ref={ref} id={iid} type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--brand))]" {...rest} />
        <span>{label}</span>
      </label>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  );
});

export function SearchInput({ value, onChange, placeholder = 'Search', className, id }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; id?: string }) {
  return (
    <div className={clsx('relative min-w-0', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
      <input id={id} type="search" className="input pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} />
    </div>
  );
}

// ───────── Display ─────────
export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'accent';
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-muted', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info', brand: 'bg-brand-soft text-brand', accent: 'bg-accent-soft text-accent',
};
export function Badge({ tone = 'neutral', children, dot = true, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12px] font-bold whitespace-nowrap', TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  ACTIVE: 'ok', INACTIVE: 'neutral', ON_HOLD: 'warn', DROPPED: 'bad', COMPLETED: 'info', MOVED: 'neutral',
  DRAFT: 'neutral', PUBLISHED: 'ok', RETIRED: 'neutral', PENDING: 'warn', APPROVED: 'ok', REJECTED: 'bad', SENT_BACK: 'warn', ESCALATED: 'bad',
  UPCOMING: 'info', RUNNING: 'ok', CANCELLED: 'bad', SCHEDULED: 'info', LIVE: 'accent',
  PRESENT: 'ok', LATE: 'warn', ABSENT: 'bad', EXCUSED: 'info',
  VALID: 'ok', VOID_PENDING: 'warn', VOIDED: 'bad', OPEN: 'warn', IN_PROGRESS: 'info', WAITING: 'neutral', RESOLVED: 'ok', CLOSED: 'neutral',
  NOT_SUBMITTED: 'neutral', SUBMITTED: 'info', CHANGES_REQUESTED: 'warn', TEACHER_APPROVED: 'brand', PROCESSING: 'warn', READY: 'ok', FAILED: 'bad',
};
export function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{labels[status] ?? status}</Badge>;
}

export function Card({ children, className, title, actions, padded = true }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode; padded?: boolean }) {
  return (
    <section className={clsx('card min-w-0', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          {typeof title === 'string' ? <h2 className="text-[15.5px] font-bold">{title}</h2> : title}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="mb-1 inline-flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-fg">
            <ChevronLeft className="h-4 w-4" aria-hidden />{back.label}
          </Link>
        )}
        <h1 className="text-[22px] font-bold leading-tight sm:text-[24px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[14.5px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: Tone }) {
  return (
    <div className="card px-4 py-3 min-w-0">
      <div className="text-[12.5px] font-semibold text-muted">{label}</div>
      <div className={clsx('mt-0.5 font-display text-[24px] font-bold tabular', tone && tone !== 'neutral' && TONES[tone].split(' ')[1])}>{value}</div>
      {sub && <div className="text-[12.5px] text-muted">{sub}</div>}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-muted" role="status">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> <span>{label}…</span>
    </div>
  );
}

export function Empty({ title, children, icon, action }: { title: string; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      <div className="text-muted">{icon ?? <Inbox className="h-8 w-8" aria-hidden />}</div>
      <p className="font-semibold">{title}</p>
      {children && <div className="max-w-md text-[14px] text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const msg = error instanceof Error ? error.message : 'Something went wrong';
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-bad" role="alert">
      <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{msg}</span>
      {retry && <Button size="sm" variant="secondary" onClick={retry}>Try again</Button>}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warn' | 'ok' | 'bad'; children: ReactNode; title?: string }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={clsx('flex gap-3 rounded-lg px-4 py-3 text-[14px]', TONES[tone])}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <div className="min-w-0 text-fg">{title && <p className="font-bold">{title}</p>}{children}</div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <p className="px-1 py-2 text-[13px] text-muted">{total} {total === 1 ? 'item' : 'items'}</p>;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 py-2 text-[13px] text-muted">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft className="h-4 w-4" /></Button>
        <span className="px-2 tabular">Page {page} of {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={clsx('flex gap-1 overflow-x-auto border-b border-line', className)} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx('whitespace-nowrap border-b-[3px] px-3 py-2.5 text-[14px] font-semibold', value === t.id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg')}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 text-[11.5px] tabular">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span
      className={clsx('inline-grid shrink-0 place-items-center rounded-full font-bold text-white', className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 45% 38%)` }}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

// ───────── Modal ─────────
export function Modal({ open, onClose, title, children, footer, size = 'md' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>('input,select,textarea,button:not([data-close])')?.focus(), 30);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); clearTimeout(t); document.body.style.overflow = ''; prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  const width = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={clsx('card flex max-h-[92vh] w-full flex-col shadow-xl', width)}>
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-[16.5px] font-bold">{title}</h2>
          <button type="button" data-close onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean; requireReason?: boolean; reasonLabel?: string };
type ConfirmFn = (o: ConfirmOpts) => Promise<{ ok: boolean; reason: string }>;
const ConfirmCtx = createContext<ConfirmFn>(async () => ({ ok: false, reason: '' }));
export const useConfirm = () => useContext(ConfirmCtx);

function ConfirmHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: { ok: boolean; reason: string }) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => { setReason(''); setState({ ...o, resolve }); }), []);
  const close = (ok: boolean) => { state?.resolve({ ok, reason }); setState(null); };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title ?? ''}
        size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state?.danger ? 'danger' : 'primary'} disabled={state?.requireReason && reason.trim().length < 3} onClick={() => close(true)}>{state?.confirmLabel ?? 'Confirm'}</Button>
        </>}
      >
        {state?.body && <div className="text-[14.5px] text-muted">{state.body}</div>}
        {state?.requireReason && <Textarea className="mt-3" label={state.reasonLabel ?? 'Reason'} value={reason} onChange={(e) => setReason(e.target.value)} required />}
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ───────── Toasts ─────────
type Toast = { id: number; tone: 'ok' | 'bad' | 'info'; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'bad' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4" style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={clsx('pointer-events-auto flex max-w-md items-center gap-2 rounded-lg px-4 py-2.5 text-[14.5px] font-semibold shadow-lg', t.tone === 'bad' ? 'bg-bad text-white' : t.tone === 'info' ? 'bg-brand text-brand-fg' : 'bg-ok text-white')}>
            {t.tone === 'bad' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function UiProviders({ children }: { children: ReactNode }) {
  return <ToastHost><ConfirmHost>{children}</ConfirmHost></ToastHost>;
}

export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={clsx('grid grid-cols-[minmax(110px,max-content)_1fr] gap-x-4 gap-y-2 text-[14.5px]', className)}>
      {items.map(([k, v], i) => (<div key={i} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v ?? '—'}</dd></div>))}
    </dl>
  );
}
