// Builds the Project Hub page: hub-data.json + live Git state -> project-hub.html
// Usage: node tools/project-hub/build.mjs   (or npm run hub)
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, 'hub-data.json'), 'utf8'));
const template = readFileSync(join(here, 'template.html'), 'utf8');

const git = (cmd) => {
  try { return execSync('git ' + cmd, { cwd: join(here, '..', '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return ''; }
};
const parseLog = (out) => out ? out.split('\n').map((l) => { const [hash, date, ...s] = l.split('\x1f'); return { hash, date, subject: s.join('\x1f') }; }) : [];
const FMT = '--format=%h%x1f%cI%x1f%s';

let gitInfo = null;
if (git('rev-parse --is-inside-work-tree') === 'true' && git('rev-parse --verify development')) {
  const devLog = parseLog(git(`log development ${FMT}`));
  const prod = git('rev-parse --verify production') ? parseLog(git(`log -1 production ${FMT}`))[0] : null;
  gitInfo = {
    head: devLog[0],
    production: prod,
    totalCommits: devLog.length,
    pendingForProduction: prod ? Number(git('rev-list --count production..development')) : devLog.length,
    checkpoints: devLog.filter((c) => c.subject.startsWith('Checkpoint:')),
    recent: devLog.slice(0, 15),
    remote: git('remote get-url origin') || null,
  };
}

const hub = { ...data, git: gitInfo, generatedAt: new Date().toISOString() };
const json = JSON.stringify(hub).replace(/</g, '\\u003c');
writeFileSync(join(here, 'project-hub.html'), template.replace('/*__HUB_DATA__*/null', json));
console.log(`Project Hub built: ${hub.cards.length} cards, ${hub.screens.length} screens${gitInfo ? `, ${gitInfo.totalCommits} commits` : ''}`);
