// One-time setup: downloads the LiveKit server (our own live-class server) into tools/bin
// and generates the database client. Safe to run again.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVEKIT_VERSION = '1.13.9';
const bin = join(root, 'tools', 'bin');
mkdirSync(bin, { recursive: true });
const exe = join(bin, process.platform === 'win32' ? 'livekit-server.exe' : 'livekit-server');

if (!existsSync(exe)) {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const ext = plat === 'windows' ? 'zip' : 'tar.gz';
  const url = `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/livekit_${LIVEKIT_VERSION}_${plat}_amd64.${ext}`;
  const work = mkdtempSync(join(tmpdir(), 'livekit-'));
  const archive = join(work, `livekit.${ext}`);
  console.log(`Downloading LiveKit ${LIVEKIT_VERSION}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  const out = join(work, 'x');
  mkdirSync(out);
  // Windows: use the built-in bsdtar (handles .zip); Git Bash's GNU tar misreads "C:" as a host.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execSync(`"${tar}" -xf "${archive}" -C "${out}"`, { stdio: 'inherit' });
  const found = readdirSync(out).find((f) => f.startsWith('livekit-server'));
  if (!found) throw new Error('livekit-server not found in the archive');
  copyFileSync(join(out, found), exe);
  rmSync(work, { recursive: true, force: true });
  console.log(`LiveKit installed at ${exe}`);
} else {
  console.log('LiveKit already installed');
}
execSync('npx prisma generate', { cwd: join(root, 'apps', 'api'), stdio: 'inherit' });
