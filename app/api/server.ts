import { serve } from '@hono/node-server';
import { createPool } from './_middleware/db';
import { issuerFor, verifierFromEnv } from './_middleware/token-verifier';
import { createApi } from './create-api';
import { devSessionEnabled } from './dev-session';

const apiDatabaseUrl = process.env.API_DATABASE_URL;
if (!apiDatabaseUrl) {
  console.error('API_DATABASE_URL is not set. Copy .env.example to .env for local development.');
  process.exit(1);
}

// Both throw a plain-language message at startup rather than failing per request.
const pool = createPool(apiDatabaseUrl);
const verifier = verifierFromEnv(process.env);

// The development sign-in door exists only on a laptop: APP_ENV=development, a
// local database, and the local secret to sign with. Never elsewhere.
const devSession = devSessionEnabled(process.env)
  ? {
      secret: process.env.SUPABASE_JWT_SECRET ?? '',
      issuer: issuerFor(process.env.SUPABASE_URL ?? ''),
    }
  : undefined;
if (devSession) {
  console.log('Development sign-in door open at POST /api/dev/session (local only).');
}

const port = Number(process.env.PORT ?? 3000);

// The hostname is explicit: serve() binds every interface when it is omitted.
// How the API is exposed in staging and production is decided with infra/.
serve(
  { fetch: createApi({ pool, verifier, devSession }).fetch, port, hostname: '127.0.0.1' },
  (info) => {
    console.log(`McWellness API listening on http://127.0.0.1:${info.port}`);
  },
);
