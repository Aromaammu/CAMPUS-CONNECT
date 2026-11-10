import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useToast } from '@/components/ui';
import { get } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { connectRealtime, disconnectRealtime, useRealtime } from '@/lib/realtime';

/** Messages shortcut with unread count; live pop-ups for new notifications. The bell arrives in Phase 8. */
export function TopbarExtras() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const loc = useLocation();
  useEffect(() => {
    if (!user) return;
    connectRealtime();
    return () => disconnectRealtime();
  }, [user]);
  const unread = useQuery({ queryKey: ['messages-unread'], queryFn: () => get<{ total: number }>('/messages/unread'), enabled: !!user, refetchInterval: 60_000 });
  useRealtime<{ sender: { id: string } }>('message', (m) => { if (m.sender.id !== user?.id) void qc.invalidateQueries({ queryKey: ['messages-unread'] }); }, !!user);
  useRealtime('read', () => void qc.invalidateQueries({ queryKey: ['messages-unread'] }), !!user);
  useRealtime<{ title: string }>('notification', (n) => toast(n.title, 'info'), !!user);
  if (!user) return null;
  const n = unread.data?.total ?? 0;
  const here = loc.pathname.startsWith('/messages');
  return (
    <Link to="/messages" className={`relative rounded-lg p-2 hover:bg-surface-2 ${here ? 'text-brand' : 'text-muted'}`} aria-label={n ? `Messages, ${n} unread` : 'Messages'}>
      <MessageSquare className="h-5 w-5" />
      {n > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-center text-[11px] font-bold leading-[18px] text-white">{n > 99 ? '99+' : n}</span>}
    </Link>
  );
}
