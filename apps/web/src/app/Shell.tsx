import { LogOut, Menu, Moon, Sun, Monitor, UserRound, X } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Avatar, clsx } from '@/components/ui';
import { roleLabel, useAuth, useUser } from '@/lib/auth';
import { getThemeChoice, setThemeChoice, ThemeChoice } from '@/lib/theme';
import { useBrand } from '@/lib/brand';
import { visibleNav } from './nav';
import { BUILT_ROUTES } from './built';
import { TopbarExtras } from './TopbarExtras';

export function Logo({ className }: { className?: string }) {
  const brand = useBrand();
  return (
    <span className={clsx('flex items-center gap-2', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden>
        <rect width="32" height="32" rx="8" fill="rgb(var(--brand))" />
        <path d="M9 20.5V11.5l7-3.5 7 3.5v9l-7 3.5z" fill="none" stroke="#F0A53A" strokeWidth="2.2" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="2.6" fill="rgb(var(--brand-fg))" />
      </svg>
      <span className="font-display text-[17px] font-bold tracking-tight">{brand.name}</span>
    </span>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const groups = visibleNav(user, BUILT_ROUTES);
  return (
    <nav aria-label="Main" className="flex flex-col gap-4 px-3 py-4">
      {groups.map((g) => (
        <div key={g.title || 'main'}>
          {g.title && <div className="px-3 pb-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted">{g.title}</div>}
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => (
              <li key={i.to + i.label}>
                <NavLink
                  to={i.to}
                  end={i.to === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => clsx(
                    'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14.5px] font-semibold',
                    isActive ? 'bg-brand-soft text-brand' : 'text-fg/80 hover:bg-surface-2 hover:text-fg',
                  )}
                >
                  <i.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{i.label}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeChoice>(getThemeChoice());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (t: ThemeChoice) => { setTheme(t); setThemeChoice(t); };
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-surface-2" aria-haspopup="menu" aria-expanded={open} aria-label="Account menu">
        <Avatar name={user.name} size={32} />
        <span className="hidden min-w-0 text-left leading-tight md:block">
          <span className="block max-w-[180px] truncate text-[14px] font-semibold">{user.name}</span>
          <span className="block text-[12px] text-muted">{roleLabel(user)}</span>
        </span>
      </button>
      {open && (
        <div role="menu" className="card absolute right-0 top-full z-40 mt-2 w-64 p-2 shadow-lg">
          <div className="px-2 py-1.5 md:hidden">
            <div className="truncate font-semibold">{user.name}</div>
            <div className="text-[12.5px] text-muted">{roleLabel(user)}</div>
          </div>
          <Link to="/profile" role="menuitem" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-2 text-[14.5px] hover:bg-surface-2">
            <UserRound className="h-4 w-4" /> My profile & password
          </Link>
          <div className="my-1 border-t border-line" />
          <div className="px-2 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">Appearance</div>
          <div className="grid grid-cols-3 gap-1 px-1 pb-1">
            {([['light', Sun, 'Light'], ['dark', Moon, 'Dark'], ['system', Monitor, 'Auto']] as const).map(([t, Icon, label]) => (
              <button key={t} type="button" onClick={() => pick(t)} aria-pressed={theme === t} className={clsx('flex flex-col items-center gap-1 rounded-md py-1.5 text-[12px] font-semibold', theme === t ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2')}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" onClick={() => logout()} className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-[14.5px] text-bad hover:bg-bad-soft">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>
      )}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);
  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex h-14 items-center gap-2" style={{ paddingLeft: 'max(12px, env(safe-area-inset-left))', paddingRight: 'max(12px, env(safe-area-inset-right))' }}>
          <button type="button" className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <Link to="/" className="mr-auto min-w-0"><Logo /></Link>
          <TopbarExtras />
          <UserMenu />
        </div>
      </header>
      <div className="lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="sticky top-14 hidden h-[calc(100vh-56px)] overflow-y-auto border-r border-line bg-surface lg:block">
          <Sidebar />
        </aside>
        {drawer && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[84%] max-w-[300px] overflow-y-auto bg-surface shadow-xl" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
              <div className="flex h-14 items-center justify-between border-b border-line px-3">
                <Logo />
                <button type="button" className="rounded-lg p-2 hover:bg-surface-2" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
              </div>
              <Sidebar onNavigate={() => setDrawer(false)} />
            </div>
          </div>
        )}
        <main className="min-w-0 py-6" style={{ paddingLeft: 'max(16px, env(safe-area-inset-left))', paddingRight: 'max(16px, env(safe-area-inset-right))' }}>
          <div className="mx-auto max-w-[1280px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
