import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** Fresh cc_test database with demo data for every test run. */
export default async function setup() {
  const root = join(__dirname, '..', '..', '..');
  const url = 'postgresql://cc:cc_local_dev@127.0.0.1:5433/cc_test';
  execSync(`node ${JSON.stringify(join(root, 'tools', 'scripts', 'recreate-db.mjs'))} cc_test`, { stdio: 'pipe' });
  execSync('node -r @swc-node/register src/seed/seed.ts', { cwd: join(root, 'apps', 'api'), stdio: 'pipe', env: { ...process.env, DATABASE_URL: url, NO_LOGIN_DOC: '1' } });
}
