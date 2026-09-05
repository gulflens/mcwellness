import { describe, expect, it } from 'vitest';
import { describeDatabase } from './apply';

/**
 * The sentence the migration guard's refusal is built on (docs/SPEC/hosting.md
 * section 5, and item 3 of section 14): it must name the database it declined —
 * host, port and name — and it must never carry the connection string, which
 * holds the password. The rule that decides a refusal is pure and lives in
 * ./plan.ts with its own tests; this is the one piece of the guard that reads a
 * URL at all, so this is where that promise is kept.
 *
 * Nothing here reaches anything: the host is in the reserved `.invalid` domain
 * and the password is one of the two throwaway words test connection strings
 * are allowed (scripts/audit-secrets.mjs).
 */

const HOSTED = 'postgresql://api_user:postgres@db.example.invalid:6543/practice';

describe('describeDatabase', () => {
  it('names the host, the port and the database and says nothing else', () => {
    // Whole-string, because the promise is as much about what is absent as
    // about what is there.
    expect(describeDatabase(HOSTED)).toBe('database "practice" at db.example.invalid:6543');
  });

  it('never carries the password, the user or the URL they sit in', () => {
    const sentence = describeDatabase(HOSTED);

    expect(sentence).toContain('db.example.invalid');
    expect(sentence).toContain('6543');
    expect(sentence).toContain('practice');
    // The password. It appears nowhere else in the sentence above, so this
    // fails if the URL ever leaks into it.
    expect(sentence).not.toContain('postgres');
    expect(sentence).not.toContain('api_user');
    expect(sentence).not.toContain('@');
    expect(sentence).not.toContain('://');
  });

  it('says 5432 when the URL leaves the port out, rather than leaving a gap', () => {
    expect(describeDatabase('postgresql://api_user:x@db.example.invalid/practice')).toBe(
      'database "practice" at db.example.invalid:5432',
    );
  });

  it('says so plainly when the URL names no database', () => {
    expect(describeDatabase('postgresql://api_user:x@db.example.invalid:6543')).toBe(
      'database "(unnamed)" at db.example.invalid:6543',
    );
  });
});
