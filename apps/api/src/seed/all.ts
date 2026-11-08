import { PrismaClient } from '@prisma/client';
import { seedOrganisation } from './demo';

/** Every phase adds its demo data here. */
export async function seedAll(prisma: PrismaClient) {
  const org = await seedOrganisation(prisma);
  return { org };
}
