import { Video } from 'lucide-react';
import { ButtonLink } from '@/components/ui';

const EARLY_MS = 15 * 60_000;

/** True while a class can be entered (the server makes the final decision on the pre-join screen). */
export function isJoinable(s: { status: string; startsAt: string; endsAt: string }, mode: string) {
  if (mode === 'OFFLINE' || s.status === 'CANCELLED' || s.status === 'COMPLETED') return false;
  if (s.status === 'LIVE') return true;
  const now = Date.now();
  return now >= new Date(s.startsAt).getTime() - EARLY_MS && now <= new Date(s.endsAt).getTime();
}

export function JoinButton({ sessionId, label, size = 'sm', live }: { sessionId: string; label: string; size?: 'sm' | 'md'; live?: boolean }) {
  return (
    <ButtonLink to={`/live/${sessionId}`} size={size} variant={live ? 'accent' : 'primary'} icon={<Video className="h-4 w-4" />}>
      {label}
    </ButtonLink>
  );
}
