import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import type { Db } from '../request-context';
import { auditDocumentRead } from './audit';

/**
 * The rule the seam carries rather than each route: a signed link is a read,
 * and the row is written where the link is signed (docs/SEAMS.md, audit.ts).
 * The trail's own contents are proved against a real database in
 * tests/db/audit.test.ts; what is proved here is the shape of the call — that
 * a caller supplies the document and nothing else.
 */

function recordingDb(): { calls: { text: string; params: unknown[] }[]; db: Db } {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Db = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      return { rows: [], rowCount: 0 } as unknown as pg.QueryResult;
    },
  };
  return { calls, db };
}

describe('auditDocumentRead', () => {
  it('writes one read against the document, carrying the client it belongs to', async () => {
    const { calls, db } = recordingDb();

    await auditDocumentRead(db, {
      id: '00000000-0000-4000-8000-0000000000f1',
      clientId: '00000000-0000-4000-8000-0000000000c1',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('insert into audit_log');
    expect(calls[0]?.params).toEqual([
      'document',
      '00000000-0000-4000-8000-0000000000f1',
      '00000000-0000-4000-8000-0000000000c1',
    ]);
  });

  it('says null for a practice document rather than inventing a client', async () => {
    const { calls, db } = recordingDb();

    await auditDocumentRead(db, { id: '00000000-0000-4000-8000-0000000000f2', clientId: null });

    expect(calls[0]?.params[2]).toBeNull();
  });

  it('takes no actor, no role and no request id: a helper that could be lied to is not one', async () => {
    const { calls, db } = recordingDb();

    await auditDocumentRead(db, { id: '00000000-0000-4000-8000-0000000000f3', clientId: null });

    // Every one of them comes off the transaction's own settings, in the SQL.
    const text = calls[0]?.text ?? '';
    for (const setting of ['app.actor_id', 'app.actor_roles', 'app.request_id', 'app.reason']) {
      expect(text).toContain(setting);
    }
    expect(calls[0]?.params).toHaveLength(3);
  });
});
