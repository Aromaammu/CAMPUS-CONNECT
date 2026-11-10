import '@livekit/components-styles';
import './live.css';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, MonitorSmartphone, PhoneOff, UserX, WifiOff } from 'lucide-react';
import { ReactNode, useCallback, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, ButtonLink, Card, Empty, ErrorBox, Spinner } from '@/components/ui';
import { get, post } from '@/lib/api';
import { PreJoin } from './PreJoin';
import { Room } from './Room';
import type { DeviceChoices, JoinResult, LeftReason, LiveInfo } from './types';

type Stage = { kind: 'prejoin' } | { kind: 'room'; join: JoinResult; choices: DeviceChoices } | { kind: 'left'; reason: LeftReason; choices: DeviceChoices };

const LEFT: Record<LeftReason, { title: string; body: string; icon: ReactNode; rejoin?: string }> = {
  left: { title: 'You left the class', body: 'You can rejoin while the class is running.', icon: <CheckCircle2 className="h-9 w-9 text-ok" />, rejoin: 'Rejoin class' },
  ended: { title: 'The class has ended', body: 'Thank you for attending. Your attendance is worked out from the time you spent in class.', icon: <PhoneOff className="h-9 w-9 text-brand" /> },
  removed: { title: 'You were removed from this class', body: 'The teacher removed you. Please contact your teacher if you think this was a mistake.', icon: <UserX className="h-9 w-9 text-bad" /> },
  duplicate: { title: 'You joined from another device', body: 'You can be in a class from one device at a time, so this window was disconnected.', icon: <MonitorSmartphone className="h-9 w-9 text-warn" />, rejoin: 'Join here instead' },
  lost: { title: 'Connection lost', body: 'We could not reconnect you. Check your internet and rejoin; your attendance time continues.', icon: <WifiOff className="h-9 w-9 text-warn" />, rejoin: 'Rejoin class' },
};

export function LivePage() {
  const { sessionId = '' } = useParams();
  const [stage, setStage] = useState<Stage>({ kind: 'prejoin' });
  const info = useQuery({
    queryKey: ['live-info', sessionId],
    queryFn: () => get<LiveInfo>(`/live/sessions/${sessionId}`),
    refetchInterval: stage.kind === 'prejoin' ? 20_000 : false,
  });
  const join = useMutation({
    mutationFn: async (choices: DeviceChoices) => ({ join: await post<JoinResult>(`/live/sessions/${sessionId}/join`), choices }),
    onSuccess: ({ join: j, choices }) => setStage({ kind: 'room', join: j, choices }),
    onError: () => void info.refetch(),
  });
  const onLeft = useCallback((reason: LeftReason) => {
    setStage((s) => ({ kind: 'left', reason, choices: s.kind === 'room' ? s.choices : { audio: true, video: true } }));
    void info.refetch();
  }, [info]);

  if (stage.kind === 'room' && info.data) return <Room info={info.data} join={stage.join} choices={stage.choices} onLeft={onLeft} />;

  const back = info.data ? `/timetable/batch/${info.data.batch.id}` : '/';
  return (
    <div className="min-h-dvh bg-bg">
      <header className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
        <Link to={back} className="inline-flex items-center gap-1.5 text-[14.5px] font-semibold text-brand hover:underline"><ArrowLeft className="h-4 w-4" />Back</Link>
        <span className="text-[14.5px] text-muted">Live class</span>
      </header>
      {info.isLoading ? <Spinner /> : info.error ? (
        <div className="mx-auto max-w-lg px-4 py-10"><ErrorBox error={info.error} /></div>
      ) : !info.data ? (
        <Empty title="Class not found" />
      ) : stage.kind === 'left' ? (
        <div className="mx-auto max-w-lg px-4 py-10">
          <Card>
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              {LEFT[stage.reason].icon}
              <h1 className="text-[20px] font-bold">{LEFT[stage.reason].title}</h1>
              <p className="text-[14.5px] text-muted">{LEFT[stage.reason].body}</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {LEFT[stage.reason].rejoin && !info.data.refusal && <Button variant="accent" loading={join.isPending} onClick={() => join.mutate(stage.choices)}>{LEFT[stage.reason].rejoin}</Button>}
                <ButtonLink to={back}>Back to the batch</ButtonLink>
              </div>
            </div>
          </Card>
        </div>
      ) : (
        <PreJoin info={info.data} onJoin={(c) => join.mutate(c)} joining={join.isPending} joinError={join.error ? (join.error as Error).message : null} />
      )}
    </div>
  );
}
