import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { config } from '../config';
import { PrismaService } from './prisma.service';

interface Job { name: string; everyMs: number; run: () => Promise<void>; timer?: NodeJS.Timeout; busy?: boolean }

/**
 * In-process scheduler (CLAUDE.md §3): each job runs on a timer; `once(key)` uses the JobRun table so
 * a piece of work happens exactly once even with several servers.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('Jobs');
  private jobs: Job[] = [];
  private started = false;
  constructor(private prisma: PrismaService) {}

  register(name: string, everyMs: number, run: () => Promise<void>) {
    const job: Job = { name, everyMs, run };
    this.jobs.push(job);
    if (this.started) this.schedule(job);
  }

  /** Runs `fn` only if no server has run `key` before. Returns whether it ran. */
  async once(key: string, fn: () => Promise<void>): Promise<boolean> {
    try {
      await this.prisma.jobRun.create({ data: { key } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
    try {
      await fn();
      return true;
    } catch (e) {
      await this.prisma.jobRun.delete({ where: { key } }).catch(() => undefined); // let it be retried
      throw e;
    }
  }

  /** Runs every registered job now (used by tests and the dev tools). */
  async runAll() {
    for (const j of this.jobs) await this.tick(j);
  }

  async runOne(name: string) {
    const j = this.jobs.find((x) => x.name === name);
    if (j) await this.tick(j);
  }

  onApplicationBootstrap() {
    if (config.disableJobs || config.isTest) return;
    this.started = true;
    this.jobs.forEach((j) => this.schedule(j));
  }

  onModuleDestroy() {
    this.jobs.forEach((j) => j.timer && clearInterval(j.timer));
  }

  private schedule(j: Job) {
    j.timer = setInterval(() => void this.tick(j), j.everyMs);
    j.timer.unref?.();
    setTimeout(() => void this.tick(j), 5_000).unref?.();
  }

  private async tick(j: Job) {
    if (j.busy) return;
    j.busy = true;
    try {
      await j.run();
    } catch (e) {
      this.log.error(`${j.name} failed: ${(e as Error).stack ?? e}`);
    } finally {
      j.busy = false;
    }
  }
}
