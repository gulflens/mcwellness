import { serve } from '@hono/node-server';
import { createApi } from './create-api';

const port = Number(process.env.PORT ?? 3000);

// The hostname is explicit: serve() binds every interface when it is omitted.
// How the API is exposed in staging and production is decided with infra/.
serve({ fetch: createApi().fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`McWellness API listening on http://127.0.0.1:${info.port}`);
});
