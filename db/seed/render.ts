import { escapeLiteral } from 'pg';
import type { IdentityKeys } from '../../domain/shared/identity';
import { applySeed, type SeedClient } from './apply';
import type { SeedData } from './generate';

/**
 * The synthetic practice as plain SQL: every statement applySeed would run,
 * with its values written as literals, so the seed can be applied through a
 * tool that takes SQL text and needs no connection string (a hosted project's
 * SQL editor or API). The transaction is left to whoever applies the script.
 */

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Buffer.isBuffer(value)) return `'\\x${value.toString('hex')}'::bytea`;
  if (Array.isArray(value)) {
    return escapeLiteral(`{${value.map((v) => String(v).replace(/[\\"]/g, '\\$&')).join(',')}}`);
  }
  return escapeLiteral(String(value));
}

/** Replaces $1, $2, ... with literals, highest index first so $1 never eats $10. */
function inline(text: string, values: unknown[]): string {
  let out = text;
  for (let i = values.length; i >= 1; i--) {
    out = out.split(`$${i}`).join(literal(values[i - 1]));
  }
  return out;
}

export async function renderSeedSql(data: SeedData, keys: IdentityKeys): Promise<string> {
  const statements: string[] = [];
  const recorder: SeedClient = {
    host: 'localhost',
    async query(text, values = []) {
      const sql = text.trim();
      const word = sql.split(/\s+/)[0]?.toLowerCase();
      if (word === 'begin' || word === 'commit' || word === 'rollback') {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith('select 1 from tenant')) {
        // isSeeded: the script targets an empty database.
        return { rows: [], rowCount: 0 };
      }
      statements.push(`${inline(sql, values)};`);
      return { rows: [], rowCount: 1 };
    },
  };
  await applySeed(recorder, data, keys);
  return `-- The synthetic practice, rendered ${new Date().toISOString()}. Apply inside one transaction.\n${statements.join('\n')}\n`;
}
