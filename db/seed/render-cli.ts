import { identityKeysFromEnv } from '../../app/api/_middleware/identity-key';
import { generateSeed } from './generate';
import { renderSeedSql } from './render';

// pnpm seed:sql — prints the synthetic practice as SQL for a hosted project,
// sealed with the IDENTITY_KEY of the environment file given to node
// (node --env-file=.env.staging --import tsx db/seed/render-cli.ts), which must
// say APP_ENV=staging. pnpm seed:sql --local renders for a local database.
const target = process.argv.includes('--local') ? 'local' : 'hosted';

try {
  process.stdout.write(
    await renderSeedSql(generateSeed(), identityKeysFromEnv(process.env), { target }),
  );
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
