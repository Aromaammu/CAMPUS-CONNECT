// Drops and recreates ONE local database (cc_dev | cc_test | cc_e2e) and applies migrations.
// Local development only; refuses any other name.
import pgPkg from 'pg';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbUrl, ensureDb } from './db.mjs';
const name = process.argv[2];
if (!['cc_dev', 'cc_test', 'cc_e2e'].includes(name)) { console.error('Usage: recreate-db.mjs cc_dev|cc_test|cc_e2e'); process.exit(1); }
await ensureDb();
const c = new pgPkg.Client({ connectionString: dbUrl('postgres') });
await c.connect();
await c.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
await c.query(`DROP DATABASE IF EXISTS ${name}`);
await c.query(`CREATE DATABASE ${name}`);
await c.end();
const api = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'apps', 'api');
execSync('npx prisma migrate deploy', { cwd: api, stdio: 'inherit', env: { ...process.env, DATABASE_URL: dbUrl(name) } });
console.log(`${name} recreated`);
