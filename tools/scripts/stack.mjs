// Starts the whole app: database, live-class server, API and website.
//   node tools/scripts/stack.mjs dev   -> http://localhost:5173 (watch mode, demo data on first run)
//   node tools/scripts/stack.mjs e2e   -> http://localhost:5174 (fresh demo database every run, used by Playwright)
import { spawn, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pgPkg from 'pg';
import { ensureDb, dbUrl } from './db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mode = process.argv[2] === 'e2e' ? 'e2e' : 'dev';
const P = mode === 'e2e' ? { api: 3100, web: 5174, lk: 7890, db: 'cc_e2e' } : { api: 3000, web: 5173, lk: 7880, db: 'cc_dev' };
const env = {
  ...process.env,
  DATABASE_URL: dbUrl(P.db),
  PORT: String(P.api),
  CC_API_PORT: String(P.api),
  CC_WEB_PORT: String(P.web),
  APP_URL: `http://localhost:${P.web}`,
  LIVEKIT_URL: `ws://127.0.0.1:${P.lk}`,
  LIVEKIT_PUBLIC_URL: `ws://localhost:${P.lk}`,
  LIVEKIT_API_KEY: 'devkey',
  LIVEKIT_API_SECRET: 'secret_dev_livekit_key_0123456789abcdef',
  CC_MODE: mode,
  FORCE_COLOR: '1',
};

await ensureDb();
const api = join(root, 'apps', 'api');
if (mode === 'e2e') {
  execSync(`node ${JSON.stringify(join(root, 'tools', 'scripts', 'recreate-db.mjs'))} cc_e2e`, { stdio: 'inherit', env });
} else {
  execSync('npx prisma migrate deploy', { cwd: api, stdio: 'inherit', env });
}
const c = new pgPkg.Client({ connectionString: env.DATABASE_URL });
await c.connect();
const { rows } = await c.query('SELECT count(*)::int AS n FROM "User"');
await c.end();
if (rows[0].n === 0) execSync('node -r @swc-node/register src/seed/seed.ts', { cwd: api, stdio: 'inherit', env: { ...env, NO_LOGIN_DOC: mode === 'e2e' ? '1' : '' } });

const procs = [];
const run = (name, cmd, args, cwd, extraEnv = {}) => {
  const p = spawn(cmd, args, { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const tag = `[${name}]`.padEnd(8);
  const out = (d) => String(d).split(/\r?\n/).filter(Boolean).forEach((l) => console.log(`${tag} ${l}`));
  p.stdout.on('data', out);
  p.stderr.on('data', out);
  p.on('exit', (code) => { console.log(`${tag} stopped (${code})`); if (name !== 'livekit') shutdown(code ?? 1); });
  procs.push(p);
};

const lkBin = join(root, 'tools', 'bin', process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');
if (existsSync(lkBin)) {
  run('livekit', lkBin, ['--config', join(root, 'tools', 'livekit', `livekit.${mode}.yaml`)], root);
} else {
  console.log('[livekit] not installed yet (run "npm run setup"); live classes will not connect');
}
run('api', 'node', mode === 'dev' ? ['--watch', '-r', '@swc-node/register', 'src/main.ts'] : ['-r', '@swc-node/register', 'src/main.ts'], api);
run('web', 'npx', ['vite', '--host', '127.0.0.1'], join(root, 'apps', 'web'));

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of procs) {
    try {
      if (process.platform === 'win32') execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
      else p.kill('SIGTERM');
    } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
