// Fails when a tracked file holds something that looks like a secret. Runs in
// pnpm verify and in CI. Placeholders documented in .env.example, CI and the
// tests are allowed by exact value; everything else that matches is a failure.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALLOWED_VALUES = [
  'local-development-only-not-a-real-secret-0123456789',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  'test-secret-that-unlocks-nothing-0123456789',
  'postgresql://postgres:postgres@localhost:5432/postgres',
  'postgresql://mcwellness_api:mcwellness_api@localhost:5432/postgres',
];
const TEST_FILE = /\.test\.tsx?$/;
const PLACEHOLDER =
  /test|synthetic|example|not-a-real|unlocks-nothing|local-development|placeholder|scrub|fake/i;
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
  {
    name: 'connection string with a password',
    re: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@[^\s'"]+/,
  },
  {
    name: 'assigned secret',
    re: /(?:secret|password|passwd|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i,
  },
];

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
        // Local databases, documented shapes with <slots>, and short test placeholders are not secrets.
        const password = match[0].replace(/^[a-z]+:\/\/[^:]+:/, '').replace(/@.*$/, '');
        if (
          LOCAL_HOST.test(match[0]) ||
          match[0].includes('<') ||
          (TEST_FILE.test(file) && password.length <= 8)
        )
          continue;
      }
      if (
        TEST_FILE.test(file) &&
        ['assigned secret', 'JSON web token'].includes(name) &&
        PLACEHOLDER.test(line)
      )
        continue;
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
