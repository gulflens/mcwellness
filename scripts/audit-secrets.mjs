// Fails when a tracked file holds something that looks like a secret. Runs in
// pnpm verify and in CI. It reads the tracked files as they are, not the
// history. The only allowances: local-host connection strings, documented
// <slot> shapes, the placeholders in .env.example and CI, and the tests' own
// fakes by exact value. A word on a line allows nothing.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWED_VALUES = [
  'local-development-only-not-a-real-secret-0123456789',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'test-secret-that-unlocks-nothing-0123456789',
  'another-test-secret-that-unlocks-nothing-9876543210',
  'test-secret-not-real-0123456789abcdef',
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJlLXNpZ25hdHVyZQ',
  'postgresql://postgres:postgres@localhost:5432/postgres',
  'postgresql://mcwellness_api:mcwellness_api@localhost:5432/postgres',
];
// Test connection strings use these two passwords and nothing else.
const TEST_PASSWORDS = new Set(['x', 'postgres']);
const TEST_FILE = /\.test\.tsx?$/;
const LOCAL_HOST = /@(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\//;
const SKIP = [
  /^pnpm-lock\.yaml$/,
  /^\.impeccable\//,
  /\.(png|jpg|jpeg|gif|woff2?|ttf|ico|pdf)$/i,
  /^scripts\/audit-secrets\.mjs$/,
];

const PATTERNS = [
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  {
    name: 'JSON web token',
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { name: 'Slack token', re: /\bxox[abpr]-[A-Za-z0-9-]{10,}/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Supabase service key', re: /service_role[^\n]{0,40}eyJ/ },
  { name: 'Supabase key', re: /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/ },
  { name: 'Supabase access token', re: /\bsbp_[A-Za-z0-9]{20,}/ },
  {
    name: 'connection string with a password',
    re: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@[^\s'"]+/,
  },
  {
    name: 'assigned secret',
    re: /(?:secret|password|passwd|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

function passwordOf(connectionString) {
  return connectionString.replace(/^[a-z]+:\/\/[^:]+:/, '').replace(/@[\s\S]*$/, '');
}

const files = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const findings = [];
for (const file of files) {
  if (SKIP.some((re) => re.test(file))) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      const match = re.exec(line);
      if (!match) continue;
      if (ALLOWED_VALUES.some((v) => line.includes(v))) continue;
      if (name === 'connection string with a password') {
        const value = match[0];
        if (LOCAL_HOST.test(value) || value.includes('<')) continue;
        if (TEST_FILE.test(file) && TEST_PASSWORDS.has(passwordOf(value))) continue;
      }
      findings.push(`${file}:${i + 1}: ${name}`);
    }
  });
}

if (findings.length > 0) {
  console.error('Secrets scan: possible secrets in tracked files:');
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`Secrets scan: ${files.length} tracked files, nothing that looks like a secret.`);
