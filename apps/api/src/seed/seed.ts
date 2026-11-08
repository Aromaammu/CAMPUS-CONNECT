import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config';
import { DEMO_LOGINS, DEMO_PASSWORD } from './demo';
import { seedAll } from './all';

/** Fills an EMPTY database with demo data and writes docs/demo-logins.md. */
async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
  if ((await prisma.user.count()) > 0) {
    console.log('Database already has data; seed skipped. Run "npm run seed -- --fresh" via tools/scripts/seed.mjs to rebuild it.');
    await prisma.$disconnect();
    return;
  }
  await seedAll(prisma);
  await prisma.$disconnect();
  if (!process.env.NO_LOGIN_DOC) {
    const rows = DEMO_LOGINS.map((l) => `| ${l.role} | ${l.name} | \`${l.email}\` | ${l.mobile} | ${l.note ?? ''} |`).join('\n');
    const doc = `# Demo logins\n\nOpen http://localhost:5173 and log in with the email **or** mobile number.\nEvery password is **\`${DEMO_PASSWORD}\`**.\n\n| Role | Name | Email | Mobile | Note |\n|---|---|---|---|---|\n${rows}\n\nThe test mailbox (every email and SMS the app would send) is at http://localhost:5173/dev/mailbox.\n`;
    writeFileSync(join(__dirname, '..', '..', '..', '..', 'docs', 'demo-logins.md'), doc);
  }
  console.log(`Seeded ${DEMO_LOGINS.length} demo logins`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
