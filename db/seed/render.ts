import { escapeLiteral } from 'pg';
import type { IdentityKeys } from '../../domain/shared/identity';
import { applySeed, type SeedClient } from './apply';
import { SEED_REASON, type SeedData } from './generate';

/**
 * The synthetic practice as plain SQL: every statement applySeed would run,
 * with its values written as literals, so the seed can travel as text to a
 * database no connection string reaches (a hosted project's SQL editor).
 *
 * Only the database is present when the script runs, so the guards travel
 * inside it: the script opens and commits its own transaction, refuses a
 * database that already holds a practice, and refuses to continue when its
 * transaction-local audit context has been lost, which is what happens when
 * it is applied statement by statement. The header names the environment it
 * was rendered for and never the key that sealed it.
 */

export type RenderTarget = 'local' | 'hosted';

/** One value as a Postgres literal, the way pg would have sent it. */
export function literal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return escapeLiteral(value);
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'::bytea`;
  if (Array.isArray(value)) {
    // As pg encodes an array: every element double-quoted, a null element bare.
    const elements = value.map((v) =>
      v === null || v === undefined ? 'NULL' : `"${String(v).replace(/[\\"]/g, '\\$&')}"`,
    );
    return escapeLiteral(`{${elements.join(',')}}`);
  }
  throw new Error(
    `The seed renderer cannot write a ${Object.prototype.toString.call(value)}; ` +
      'the seed uses strings, numbers, booleans, buffers and arrays.',
  );
}

/**
 * Replaces $1, $2, ... with literals in one pass, so a literal already written
 * is never scanned again and a value that itself contains "$1" stays intact.
 * The seed's statements carry no dollar sign inside quotes or dollar-quoting.
 */
export function inline(text: string, values: unknown[]): string {
  return text.replace(/\$(\d+)/g, (_, n: string) => {
    const index = Number(n) - 1;
    if (index < 0 || index >= values.length) {
      throw new Error(`Statement refers to $${n} but ${values.length} values were given.`);
    }
    return literal(values[index]);
  });
}

const EMPTY_DATABASE_GUARD =
  "do $$ begin if exists (select 1 from tenant) then raise exception 'This database already holds a practice; the synthetic seed fills an empty one.'; end if; end $$;";
const ONE_TRANSACTION_GUARD =
  `do $$ begin if coalesce(current_setting('app.reason', true), '') <> ${escapeLiteral(SEED_REASON)} ` +
  "then raise exception 'Apply this script as one transaction: its audit context was lost.'; end if; end $$;";

export async function renderSeedSql(
  data: SeedData,
  keys: IdentityKeys,
  options: { target: RenderTarget },
): Promise<string> {
  const statements: string[] = [];
  const recorder: SeedClient = {
    // A hosted target goes through the same refusal pnpm seed applies: APP_ENV must say staging.
    host: options.target === 'local' ? 'localhost' : 'hosted.invalid',
    async query(text, values = []) {
      const sql = text.trim();
      if (sql.startsWith('select 1 from tenant')) {
        // isSeeded: the script targets an empty database, and says so itself.
        statements.push(EMPTY_DATABASE_GUARD);
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("select set_config('app.reason'")) {
        // Each application is its own request, and must be one transaction.
        const [reason, requestId] = values as [string, string];
        statements.push(
          `${sql.replace('$1', literal(reason)).replace('$2', 'gen_random_uuid()::text')};`,
          ONE_TRANSACTION_GUARD,
        );
        void requestId;
        return { rows: [], rowCount: 1 };
      }
      statements.push(`${inline(sql, values)};`);
      return { rows: [], rowCount: 1 };
    },
  };
  await applySeed(recorder, data, keys);
  const header =
    `-- The synthetic practice, rendered ${new Date().toISOString()} for a ${options.target} database ` +
    `(APP_ENV=${process.env.APP_ENV ?? 'unset'}). Apply it whole: it opens and commits its own transaction, ` +
    'refuses a database that already holds a practice, and stops if applied statement by statement. ' +
    'Sealed values open only under the identity key of the environment it was rendered with.';
  return `${header}\n${statements.join('\n')}\n`;
}
