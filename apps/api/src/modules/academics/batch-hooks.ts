import { Injectable, Logger } from '@nestjs/common';

type Fn = (...ids: string[]) => Promise<void> | void;

/**
 * Later phases react to academic events without the academics module knowing about them:
 * Phase 5 creates project records, Phase 6 keeps batch chat groups in sync, Phase 7 creates fee plans.
 */
@Injectable()
export class BatchHooks {
  private log = new Logger('BatchHooks');
  private listeners: Record<'batchCreated' | 'membersChanged' | 'enrolled' | 'enrolmentMoved', Fn[]> = { batchCreated: [], membersChanged: [], enrolled: [], enrolmentMoved: [] };

  on(event: keyof BatchHooks['listeners'], fn: Fn) { this.listeners[event].push(fn); }

  private async emit(event: keyof BatchHooks['listeners'], ...ids: string[]) {
    for (const fn of this.listeners[event]) {
      try { await fn(...ids); } catch (e) { this.log.error(`${event} listener failed: ${(e as Error).message}`); }
    }
  }

  batchCreated(batchId: string) { return this.emit('batchCreated', batchId); }
  membersChanged(batchId: string) { return this.emit('membersChanged', batchId); }
  enrolled(enrolmentId: string) { return this.emit('enrolled', enrolmentId); }
  enrolmentMoved(fromEnrolmentId: string, toEnrolmentId: string) { return this.emit('enrolmentMoved', fromEnrolmentId, toEnrolmentId); }
}
