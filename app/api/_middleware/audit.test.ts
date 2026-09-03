import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { logAction, logRead, logReads } from './audit';
import type { Db } from './request-context';

/**
 * The trail's own contents are proved against a real database in
 * tests/db/audit.test.ts. What is proved here is the shape of the call: which
 * facts a caller supplies, and which ones it cannot supply because they come
 * off the transaction's own settings in the SQL.
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

/** Every context column the SQL takes for itself rather than from the caller. */
const FROM_THE_TRANSACTION = ['app.actor_id', 'app.actor_roles', 'app.request_id', 'app.reason'];

describe('logAction', () => {
  it('writes one row naming the act, the entity and the client it belongs to', async () => {
    const { calls, db } = recordingDb();

    await logAction(
      db,
      'document.sent',
      {
        type: 'invoice',
        id: '00000000-0000-4000-8000-0000000000a1',
        clientId: '00000000-0000-4000-8000-0000000000c1',
      },
      { contactId: '00000000-0000-4000-8000-0000000000e1', channel: 'whatsapp' },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain('insert into audit_log');
    expect(calls[0]?.params).toEqual([
      'document.sent',
      'invoice',
      '00000000-0000-4000-8000-0000000000a1',
      '00000000-0000-4000-8000-0000000000c1',
      '{"contactId":"00000000-0000-4000-8000-0000000000e1","channel":"whatsapp"}',
    ]);
  });

  it('says null for an entity with no client rather than inventing one', async () => {
    const { calls, db } = recordingDb();

    await logAction(
      db,
      'document.sent',
      { type: 'invoice', id: '00000000-0000-4000-8000-0000000000a2', clientId: null },
      { channel: 'email' },
    );

    expect(calls[0]?.params[3]).toBeNull();
  });

  it('takes no actor, no role, no reason and no request id: a helper that could be lied to is not one', async () => {
    const { calls, db } = recordingDb();

    await logAction(
      db,
      'document.sent',
      { type: 'invoice', id: '00000000-0000-4000-8000-0000000000a3', clientId: null },
      {},
    );

    const text = calls[0]?.text ?? '';
    for (const setting of FROM_THE_TRANSACTION) {
      expect(text).toContain(setting);
    }
    expect(calls[0]?.params).toHaveLength(5);
  });

  it('writes the details as given: nothing on this path redacts them', async () => {
    // app.audit_redact is reached only from app.audit_row, the trigger on the
    // audited tables. A row written straight into audit_log carries exactly
    // what the caller passed, which is why the rule is that details hold ids
    // and channels and never a way to reach a family (audit.ts, audit.md
    // section 8). This test states the fact the rule rests on.
    const { calls, db } = recordingDb();

    await logAction(
      db,
      'document.sent',
      { type: 'invoice', id: '00000000-0000-4000-8000-0000000000a4', clientId: null },
      { contactId: '00000000-0000-4000-8000-0000000000e4', channel: 'whatsapp' },
    );

    expect(calls[0]?.text).not.toContain('audit_redact');
    expect(JSON.parse(String(calls[0]?.params[4]))).toEqual({
      contactId: '00000000-0000-4000-8000-0000000000e4',
      channel: 'whatsapp',
    });
  });
});

describe('logRead and logReads, beside it', () => {
  it('logRead writes a read and takes its context from the transaction too', async () => {
    const { calls, db } = recordingDb();

    await logRead(db, 'document', '00000000-0000-4000-8000-0000000000f1', null);

    expect(calls[0]?.text).toContain("'read'");
    for (const setting of FROM_THE_TRANSACTION) {
      expect(calls[0]?.text).toContain(setting);
    }
  });

  it('logReads writes nothing at all for an empty list', async () => {
    const { calls, db } = recordingDb();

    await logReads(db, 'client', []);

    expect(calls).toHaveLength(0);
  });
});
