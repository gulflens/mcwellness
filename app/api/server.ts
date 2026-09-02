import { serve } from '@hono/node-server';
import { createPool } from './_middleware/db';
import { limitsFromEnv, trustedProxyHopsFromEnv } from './_middleware/rate-limit';
import { issuerFor, verifierFromEnv } from './_middleware/token-verifier';
import { createApi } from './create-api';
import { devSessionEnabled, isLoopback } from './dev-session';
import { mountApp } from './serve-app';

const apiDatabaseUrl = process.env.API_DATABASE_URL;
if (!apiDatabaseUrl) {
  console.error('API_DATABASE_URL is not set. Copy .env.example to .env for local development.');
  process.exit(1);
}

// Both throw a plain-language message at startup rather than failing per request.
const pool = createPool(apiDatabaseUrl);
const verifier = verifierFromEnv(process.env);

// The development sign-in door exists only on a laptop: APP_ENV=development, a
// local database, a local Supabase URL and the local secret to sign with.
const devSession = devSessionEnabled(process.env)
  ? {
      secret: process.env.SUPABASE_JWT_SECRET ?? '',
      issuer: issuerFor(process.env.SUPABASE_URL ?? ''),
    }
  : undefined;
if (devSession) {
  console.log('Development sign-in door open at POST /api/dev/session (local only).');
}

const api = createApi({
  pool,
  verifier,
  devSession,
  appEnv: process.env.APP_ENV,
  supabaseUrl: process.env.SUPABASE_URL,
  limits: limitsFromEnv(process.env),
  trustedProxyHops: trustedProxyHopsFromEnv(process.env),
});

// SERVE_APP=true: the built app (pnpm build) is served by this process too, so
// the protective headers cover the screens as well as the data.
if (process.env.SERVE_APP === 'true') {
  mountApp(api);
  console.log('Serving the built app from dist/.');
}

const port = Number(process.env.PORT ?? 3000);
// The hostname is explicit: serve() binds every interface when it is omitted.
// A deployment sets HOST to what its reverse proxy reaches.
const hostname = process.env.HOST ?? '127.0.0.1';
if (devSession && !isLoopback(hostname)) {
  console.error(
    `The development sign-in door cannot be open on ${hostname}. Use a loopback HOST, or close the door.`,
  );
  process.exit(1);
}

serve({ fetch: api.fetch, port, hostname }, (info) => {
  console.log(`McWellness API listening on http://${hostname}:${info.port}`);
});
