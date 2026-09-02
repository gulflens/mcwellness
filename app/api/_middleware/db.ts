import pg from 'pg';

/**
 * The API's connection pool. The API connects as its own role, never as the
 * owner: `mcwellness_api` locally, `mcwellness_api.<ref>` through Supabase's
 * pooler. Anything else is refused at startup.
 */

const API_USER = /^mcwellness_api(\.[a-z0-9]+)?$/;

export function assertApiRoleUrl(url: string): void {
  const user = decodeURIComponent(new URL(url).username);
  if (!API_USER.test(user)) {
    throw new Error(`API_DATABASE_URL must connect as mcwellness_api, not as "${user}".`);
  }
}

let dateParserPinned = false;

export function createPool(url: string): pg.Pool {
  assertApiRoleUrl(url);
  if (!dateParserPinned) {
    // A Postgres date stays the YYYY-MM-DD text it is; never a local-midnight Date.
    pg.types.setTypeParser(1082, (value) => value);
    dateParserPinned = true;
  }
  return new pg.Pool({
    connectionString: url,
    max: 10,
    connectionTimeoutMillis: 5_000,
    application_name: 'mcwellness-api',
  });
}
