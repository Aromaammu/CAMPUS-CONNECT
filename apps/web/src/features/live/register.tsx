import { SESSION_ACTIONS } from '../academics/batchTabs';
import { TIMETABLE_ACTIONS } from '../academics/timetableActions';
import { JoinButton, isJoinable } from './JoinButton';

/** Phase 3: "Join class" buttons on batch class lists and the timetable. */
SESSION_ACTIONS.push(({ batch, session }) => {
  if (!isJoinable(session, batch.mode)) return null;
  const live = session.status === 'LIVE';
  const label = batch.viewerRole === 'student' ? 'Join class' : batch.isTeacher ? (live ? 'Join class' : 'Start class') : 'Observe';
  return <JoinButton sessionId={session.id} label={label} live={live} />;
});

TIMETABLE_ACTIONS.push(({ item }) => {
  if (!isJoinable(item, item.mode)) return null;
  return <JoinButton sessionId={item.id} label="Join" live={item.status === 'LIVE'} />;
});
