// pnpm worktree:add <name> / pnpm worktree:remove <name>
//
// One worktree per parallel session: its own branch, its own database on its
// own port, its own API and web ports, its own dependencies. The ports come
// from the table in docs/SPEC/OWNERSHIP.md, repeated here so the script and
// the map cannot drift apart silently; the recipe is docs/PARALLEL-SESSIONS.md.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const WORKTREES = {
  'client-record': { db: 5433, api: 3001, web: 5174 },
  scheduling: { db: 5434, api: 3002, web: 5175 },
  'session-capture': { db: 5435, api: 3003, web: 5176 },
  billing: { db: 5436, api: 3004, web: 5177 },
  assessment: { db: 5437, api: 3005, web: 5178 },
  reports: { db: 5438, api: 3006, web: 5179 },
  'client-portal': { db: 5439, api: 3007, web: 5180 },
  'audit-ui': { db: 5440, api: 3008, web: 5181 },
  accounting: { db: 5443, api: 3011, web: 5184 },
};

const [command, name, base = 'main'] = process.argv.slice(2);
const trunk = process.cwd();

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(file, args, cwd = trunk) {
  return execFileSync(file, args, { cwd, stdio: 'inherit' });
}

function quiet(file, args, cwd = trunk) {
  return execFileSync(file, args, { cwd, encoding: 'utf8' }).trim();
}

if (!command || !['add', 'remove'].includes(command)) {
  fail('Usage: pnpm worktree:add <name> [base branch] | pnpm worktree:remove <name>');
}
if (!name || !(name in WORKTREES)) {
  fail(
    `Unknown worktree ${JSON.stringify(name ?? '')}. The ownership map names: ${Object.keys(WORKTREES).join(', ')}.`,
  );
}

const ports = WORKTREES[name];
const dir = resolve(trunk, '..', `${basename(trunk)}-${name}`);
const project = `mcwellness-${name}`;

/** The worktree's .env: the example's local placeholders with this worktree's ports. */
function envFor() {
  const example = readFileSync(join(trunk, '.env.example'), 'utf8');
  const overrides = {
    DATABASE_URL: `postgresql://postgres:postgres@localhost:${ports.db}/postgres`,
    API_DATABASE_URL: `postgresql://mcwellness_api:mcwellness_api@localhost:${ports.db}/postgres`,
    DB_PORT: String(ports.db),
    PORT: String(ports.api),
    WEB_PORT: String(ports.web),
    COMPOSE_PROJECT_NAME: project,
  };
  const seen = new Set();
  const lines = example.split('\n').map((line) => {
    const match = /^([A-Z_]+)=/.exec(line);
    if (!match || !(match[1] in overrides)) return line;
    seen.add(match[1]);
    return `${match[1]}=${overrides[match[1]]}`;
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

if (command === 'add') {
  if (existsSync(dir)) fail(`${dir} already exists. Remove it first, or pick another worktree.`);
  const branches = quiet('git', ['branch', '--list', name]);
  console.log(`Creating the ${name} worktree at ${dir}`);
  run('git', ['worktree', 'add', dir, ...(branches ? [name] : ['-b', name, base])]);
  writeFileSync(join(dir, '.env'), envFor());
  console.log(
    `Ports: database ${ports.db}, API ${ports.api}, web ${ports.web}; container ${project}.`,
  );
  console.log('Installing dependencies.');
  run('pnpm', ['install', '--silent'], dir);
  console.log('Starting its database.');
  run('pnpm', ['db:up'], dir);
  console.log('Applying the migrations and seeding the synthetic practice.');
  run('pnpm', ['db:migrate'], dir);
  run('pnpm', ['seed'], dir);
  console.log(`\nReady. Open a Claude Code session in ${dir}.`);
  console.log('It owns only the paths docs/SPEC/OWNERSHIP.md gives it.');
} else {
  if (!existsSync(dir)) fail(`${dir} does not exist; nothing to remove.`);
  console.log(`Stopping and removing the ${name} database (its data goes with it).`);
  try {
    run('pnpm', ['exec', 'docker', 'compose', 'down', '--volumes'], dir);
  } catch {
    console.log('Its database was not running.');
  }
  console.log('Removing the worktree.');
  run('git', ['worktree', 'remove', dir, '--force']);
  run('git', ['worktree', 'prune']);
  console.log(`Removed. The ${name} branch stays in git history.`);
}
