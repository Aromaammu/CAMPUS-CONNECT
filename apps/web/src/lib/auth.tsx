import { Permission, SessionUser, can } from '@cc/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ReactNode, createContext, useContext, useEffect } from 'react';
import { ApiError, get, post } from './api';

interface Me { user: SessionUser; needsConsent: boolean; isMinor: boolean }
interface SessionResponse { user: SessionUser | null; needsConsent?: boolean; isMinor?: boolean }
interface AuthState {
  me: Me | null;
  user: SessionUser | null;
  loading: boolean;
  refetch: () => Promise<unknown>;
  logout: () => Promise<void>;
  can: (perm: Permission, branchId?: string | null) => boolean;
  canAny: (...perms: Permission[]) => boolean;
}
const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      try {
        const r = await get<SessionResponse>('/auth/session');
        return r.user ? (r as Me) : null;
      } catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null; throw e; }
    },
    staleTime: 60_000,
    retry: false,
  });
  useEffect(() => {
    const onOut = () => { qc.setQueryData(['me'], null); };
    window.addEventListener('cc:logged-out', onOut);
    return () => window.removeEventListener('cc:logged-out', onOut);
  }, [qc]);
  const user = q.data?.user ?? null;
  const value: AuthState = {
    me: q.data ?? null,
    user,
    loading: q.isLoading,
    refetch: q.refetch,
    logout: async () => {
      await post('/auth/logout').catch(() => null);
      qc.setQueryData(['me'], null);
      qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    },
    can: (perm, branchId) => !!user && can(user, perm, branchId),
    canAny: (...perms) => !!user && perms.some((p) => can(user, p)),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth outside AuthProvider');
  return c;
}

/** The user, guaranteed (inside the logged-in layout). */
export function useUser(): SessionUser {
  const { user } = useAuth();
  if (!user) throw new Error('Not logged in');
  return user;
}

/** "Dr. Thomas Mathew" -> "Thomas" */
export function firstName(name: string) {
  return name.split(/s+/).find((w) => !w.endsWith('.')) ?? name;
}

export function roleLabel(u: SessionUser): string {
  if (u.kind === 'SUPER_ADMIN') return 'Super Admin';
  if (u.kind === 'ADMIN') return u.modules.includes('accounts') && u.modules.length === 1 ? 'Head of Accounts' : 'Admin';
  if (u.kind === 'STUDENT') return 'Student';
  return u.designation ?? 'Staff';
}
