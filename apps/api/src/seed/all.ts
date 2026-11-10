import { PrismaClient } from '@prisma/client';
import { seedOrganisation } from './demo';
import { seedAcademics } from './academics';
import { ensureDemoClass } from './live';
import { seedAttendance } from './attendance';
import { seedRecordings } from './recordings';
import { seedLearning } from './learning';

/** Every phase adds its demo data here. */
export async function seedAll(prisma: PrismaClient) {
  const org = await seedOrganisation(prisma);
  const academics = await seedAcademics(prisma, org);
  await seedAttendance(prisma);
  await seedRecordings(prisma);
  await seedLearning(prisma);
  const demoClass = await ensureDemoClass(prisma);
  return { org, academics, demoClass };
}
