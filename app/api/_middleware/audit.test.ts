import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { logAction, logRead, logReads, refuseContactDetails } from './audit';
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

  it('hands the details to the insert as given, and lets the database redact them', async () => {
    // This route composes no redaction of its own: app.audit_chain_link()
    // does it on the way in, whichever path wrote the row (migration 908).
    // What the caller passes is what the insert carries; what the trail keeps
    // is what the redaction leaves, which tests/db/audit.test.ts proves
    // against a real database.
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

describe('what logAction refuses to write down', () => {
  /**
   * The rule the helper's own comment states, enforced rather than trusted
   * (docs/SPEC/audit.md section 8): the details hold ids and the shape of the
   * act, never a way to reach a family. A number under a key nothing drops is
   * short and unremarkable, so the database's redaction would not catch it;
   * this is what does.
   */
  const ENTITY = { type: 'document', id: '00000000-0000-4000-8000-0000000000a5', clientId: null };

  it('refuses a telephone number, naming the key and never the number', async () => {
    const { calls, db } = recordingDb();

    await expect(
      logAction(db, 'send', ENTITY, { channel: 'whatsapp', sentTo: '+971500000001' }),
    ).rejects.toThrow('may not carry a telephone number; "sentTo" does');
    expect(calls).toHaveLength(0);
  });

  it('refuses one written the way a person types it, inside a longer sentence', async () => {
    const { db } = recordingDb();

    await expect(
      logAction(db, 'send', ENTITY, { note: 'handed to +971 50 000 0001 at the door' }),
    ).rejects.toThrow('may not carry a telephone number');
  });

  it('refuses an email address, naming the key and never the address', async () => {
    const { calls, db } = recordingDb();

    await expect(
      logAction(db, 'send', ENTITY, { channel: 'email', sentTo: 'nobody@example.invalid' }),
    ).rejects.toThrow('may not carry an email address; "sentTo" does');
    expect(calls).toHaveLength(0);
  });

  it('throws before the insert, so no half-written row reaches the trail', async () => {
    const { calls, db } = recordingDb();

    await expect(
      logAction(db, 'send', ENTITY, { contactId: '00000000-0000-4000-8000-0000000000e5' }),
    ).resolves.toBeUndefined();
    await expect(logAction(db, 'send', ENTITY, { to: '+971500000002' })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  it('leaves an id, a channel and a money figure alone', async () => {
    // Nothing here reads as a way to reach anybody, and a helper that refused
    // an invoice reference or a figure would be a helper nobody could use.
    expect(() =>
      refuseContactDetails({
        contactId: '00000000-0000-4000-8000-0000000000e6',
        channel: 'whatsapp',
        reference: 'INV-000012',
        grossFils: '103250',
        delivered: 'false',
      }),
    ).not.toThrow();
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
