import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatWeekdayDate } from '@cc/shared';
import { config } from '../config';

/** A few ready recordings of past classes (sample video), one hidden from students, one in Thiruvananthapuram. */
export async function seedRecordings(prisma: PrismaClient) {
  const sample = join(__dirname, '..', '..', 'assets', 'sample-recording.webm');
  const size = statSync(sample).size;
  const director = await prisma.user.findUniqueOrThrow({ where: { email: 'director@demo.cc' } });
  const pick = async (batch: string, take: number) => prisma.session.findMany({
    where: { batch: { name: batch }, status: 'COMPLETED' }, orderBy: { startsAt: 'desc' }, take, include: { batch: { select: { name: true, branchId: true } } },
  });
  const sessions = [...(await pick('Morning Batch A', 3)), ...(await pick('Afternoon Batch', 1))];
  for (const [i, s] of sessions.entries()) {
    const key = `recording/seed/${randomUUID()}`;
    mkdirSync(dirname(join(config.storageDir, key)), { recursive: true });
    copyFileSync(sample, join(config.storageDir, key));
    const f = await prisma.fileObject.create({ data: { storageKey: key, name: `${s.batch.name} class ${s.position}.webm`, mime: 'video/webm', sizeBytes: size, uploadedById: director.id, purpose: 'recording' } });
    await prisma.recording.create({
      data: {
        sessionId: s.id, branchId: s.batch.branchId, title: `${s.batch.name} · Class ${s.position} · ${formatWeekdayDate(s.startsAt)}`,
        status: 'READY', fileId: f.id, sizeBytes: size, durationSec: Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 1000),
        startedAt: s.startsAt, endedAt: s.endsAt, createdAt: s.endsAt, expiresAt: new Date(s.endsAt.getTime() + 180 * 86400_000),
        hidden: i === 2,
      },
    });
  }
}
