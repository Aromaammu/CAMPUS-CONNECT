// Update hub-data.json from the command line, then rebuild the page.
//   node tools/project-hub/set.mjs card "<title substring>" <status> ["waiting text" | -]
//   node tools/project-hub/set.mjs phase <id> <status>          (all cards of a phase)
//   node tools/project-hub/set.mjs add <phase> <status> "<area>" "<title>" "<detail>" ["waiting"]
//   node tools/project-hub/set.mjs decision <id> <needed|confirm|done> ["default text"]
//   node tools/project-hub/set.mjs headline "<text>"
//   node tools/project-hub/set.mjs mode <supervised|unsupervised>
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const file = join(here, 'hub-data.json');
const data = JSON.parse(readFileSync(file, 'utf8'));
const [cmd, ...a] = process.argv.slice(2);
const STATUSES = ['planned', 'notstarted', 'dev', 'test', 'done'];
const need = (s) => { if (!STATUSES.includes(s)) throw new Error('Unknown status ' + s); return s; };

switch (cmd) {
  case 'card': {
    const matches = data.cards.filter((c) => c.t.toLowerCase().includes(a[0].toLowerCase()));
    if (matches.length !== 1) throw new Error(`"${a[0]}" matched ${matches.length} cards: ${matches.map((m) => m.t).join(' | ')}`);
    matches[0].s = need(a[1]);
    if (a[2] === '-') delete matches[0].w; else if (a[2]) matches[0].w = a[2];
    break;
  }
  case 'phase': data.cards.filter((c) => c.p === a[0]).forEach((c) => { c.s = need(a[1]); }); break;
  case 'add': { const c = { p: a[0], s: need(a[1]), a: a[2], t: a[3], d: a[4] }; if (a[5]) c.w = a[5]; data.cards.push(c); break; }
  case 'decision': {
    const d = data.decisions.find((x) => x.id === a[0]);
    if (!d) throw new Error('No decision ' + a[0]);
    d.state = a[1]; if (a[2]) d.default = a[2];
    break;
  }
  case 'headline': data.headline = a[0]; break;
  case 'mode': data.mode = a[0]; break;
  default: throw new Error('Unknown command ' + cmd);
}
const now = new Date(Date.now() + 5.5 * 3600e3);
data.statusDate = now.toISOString().slice(0, 10);
writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
execSync('node ' + JSON.stringify(join(here, 'build.mjs')), { stdio: 'inherit' });
