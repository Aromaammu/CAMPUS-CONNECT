// Unit + API integration tests (real Postgres test database).
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDb } from './db.mjs';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
await ensureDb();
execSync('npx vitest run', { cwd: join(root, 'apps', 'api'), stdio: 'inherit' });
execSync('npx vitest run', { cwd: join(root, 'packages', 'shared'), stdio: 'inherit' });
execSync('npx vitest run --passWithNoTests', { cwd: join(root, 'apps', 'web'), stdio: 'inherit' });
