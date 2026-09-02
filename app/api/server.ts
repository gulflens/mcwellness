import { serve } from '@hono/node-server';
import { createPool } from './_middleware/db';
import { verifierFromEnv } from './_middleware/token-verifier';
import { createApi } from './create-api';

const apiDatabaseUrl = process.env.API_DATABASE_URL;
if (!apiDatabaseUrl) {
  console.error('API_DATABASE_URL is not set. Copy .env.example to .env for local development.');
  process.exit(1);
}

// Both throw a plain-language message at startup rather than failing per request.
const pool = createPool(apiDatabaseUrl);
const verifier = verifierFromEnv(process.env);

const port = Number(process.env.PORT ?? 3000);

// The hostname is explicit: serve() binds every interface when it is omitted.
// How the API is exposed in staging and production is decided with infra/.
serve({ fetch: createApi({ pool, verifier }).fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`McWellness API listening on http://127.0.0.1:${info.port}`);
});
