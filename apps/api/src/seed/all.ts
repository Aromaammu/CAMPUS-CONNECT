import { PrismaClient } from '@prisma/client';
import { seedOrganisation } from './demo';
import { seedAcademics } from './academics';

/** Every phase adds its demo data here. */
export async function seedAll(prisma: PrismaClient) {
  const org = await seedOrganisation(prisma);
  const academics = await seedAcademics(prisma, org);
  return { org, academics };
}
