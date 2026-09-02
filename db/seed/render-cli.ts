import { identityKeysFromEnv } from '../../app/api/_middleware/identity-key';
import { generateSeed } from './generate';
import { renderSeedSql } from './render';

// pnpm seed:sql — prints the synthetic practice as SQL, sealed with the
// IDENTITY_KEY of the environment file given to node (--env-file=...).
try {
  process.stdout.write(await renderSeedSql(generateSeed(), identityKeysFromEnv(process.env)));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
