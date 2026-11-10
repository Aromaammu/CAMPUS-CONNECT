// Starts the local PostgreSQL 16 (embedded binaries, no install needed) and keeps it running.
// Uses pg_ctl so it also works under an Administrator account (pg_ctl drops admin rights).
// Creates the cc_dev, cc_test and cc_e2e databases on first run.
//   node tools/scripts/db.mjs          -> start (stays running in the background) and exit
//   node tools/scripts/db.mjs stop     -> stop
//   import { ensureDb } from './db.mjs'
import EmbeddedPostgres from 'embedded-postgres';
import pgPkg from 'pg';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(root, 'node_modules', '@embedded-postgres', 'windows-x64', 'native', 'bin');
const DATA = join(root, '.data', 'pg');
export const DB_PORT = Number(process.env.CC_DB_PORT || 5433);
export const DB_USER = 'cc';
export const DB_PASSWORD = 'cc_local_dev';
export const DATABASES = ['cc_dev', 'cc_test', 'cc_e2e'];
/** Always Unicode, whatever the computer's language settings. */
export const createDbSql = (name) => `CREATE DATABASE ${name} ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`;
export const dbUrl = (name) => `postgresql://${DB_USER}:${DB_PASSWORD}@127.0.0.1:${DB_PORT}/${name}`;

export function portOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host });
    s.once('connect', () => { s.end(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1000, () => { s.destroy(); resolve(false); });
  });
}

const pgCtl = (...args) => execFileSync(join(BIN, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'), args, { stdio: 'ignore' });

export async function ensureDb() {
  if (!(await portOpen(DB_PORT))) {
    if (!existsSync(join(DATA, 'PG_VERSION'))) {
      mkdirSync(DATA, { recursive: true });
      const init = new EmbeddedPostgres({ databaseDir: DATA, user: DB_USER, password: DB_PASSWORD, port: DB_PORT, persistent: true, onLog: () => {}, onError: () => {} });
      await init.initialise();
    }
    mkdirSync(join(root, '.data'), { recursive: true });
    pgCtl('-D', DATA, '-o', `-p ${DB_PORT} -c max_connections=200 -c listen_addresses=127.0.0.1`, '-l', join(root, '.data', 'pg.log'), '-w', '-t', '60', 'start');
  }
  const client = new pgPkg.Client({ connectionString: dbUrl('postgres') });
  await client.connect();
  const { rows } = await client.query('SELECT datname FROM pg_database');
  for (const name of DATABASES) if (!rows.some((r) => r.datname === name)) await client.query(createDbSql(name));
  // Databases made before 10-11-2026 used the Windows code page and could not store ₹, Indian scripts or emoji.
  // They only ever hold demo data, so rebuild them as Unicode (the API re-seeds an empty database).
  const { rows: enc } = await client.query("SELECT datname FROM pg_database WHERE datname = ANY($1) AND pg_encoding_to_char(encoding) <> 'UTF8'", [DATABASES]);
  for (const { datname } of enc) {
    console.log(`[db] rebuilding ${datname} as Unicode (UTF-8)`);
    await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [datname]);
    await client.query(`DROP DATABASE ${datname}`);
    await client.query(createDbSql(datname));
  }
  await client.end();
}

export function stopDb() {
  try { pgCtl('-D', DATA, '-m', 'fast', 'stop'); } catch { /* not running */ }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'stop') { stopDb(); console.log('Database stopped'); }
  else { await ensureDb(); console.log(`Database running on port ${DB_PORT} (${DATABASES.join(', ')})`); }
}
