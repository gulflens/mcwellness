import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { seededRandom, type Random } from '../../../db/seed/random';
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

const HEX_DIGITS = [...'0123456789abcdef'];

/**
 * A version 4 uuid from a seeded source: the shape `randomUUID()` writes,
 * without the randomness a test may not hold (.claude/rules/testing.md).
 */
function uuidFrom(random: Random): string {
  const hex = (length: number): string =>
    Array.from({ length }, () => random.pick(HEX_DIGITS)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${random.pick(['8', '9', 'a', 'b'])}${hex(3)}-${hex(12)}`;
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

  it('refuses a bare number with no plus, local or with the country code', async () => {
    // A number reaches a detail written both ways: as a person writes it on a
    // form, and as a system strips it.
    for (const number of ['0501234567', '971501234567', '050 123 4567', '050-123-4567']) {
      const { calls, db } = recordingDb();
      await expect(logAction(db, 'send', ENTITY, { sentTo: number })).rejects.toThrow(
        'may not carry a telephone number',
      );
      expect(calls).toHaveLength(0);
    }
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

  it('leaves an all-digit uuid alone: it is one long run, not a nine-digit number', () => {
    // The boundary between runs is what keeps ids out of this. Every id the
    // platform writes is thirty-two digits with hyphens between, and judged
    // whole it is far too long to be a telephone number; judged through a
    // window it would look like one every time.
    expect(() =>
      refuseContactDetails({
        documentId: '00000000-0000-4000-8000-000000000909',
        invoiceId: '00000001-0000-4000-8000-000000000001',
      }),
    ).not.toThrow();
  });

  it('leaves a year, a date and a reference number alone', () => {
    expect(() =>
      refuseContactDetails({
        year: '2026',
        issuedOn: '2026-09-04',
        number: '12',
        reference: 'INV-000012',
        version: '1.0',
      }),
    ).not.toThrow();
  });

  it('refuses a nine-digit run of its own that starts with a zero, and says why that is right', () => {
    // 04 123 4567 is a Dubai landline and 000000012 is a padded reference, and
    // stripped of their punctuation the two are the same nine digits. The
    // helper cannot tell them apart and refuses, which is the safe direction:
    // a reference is written as it is printed (INV-000012, above) and loses
    // nothing, where a landline written bare would sit in the trail for five
    // years.
    expect(() => refuseContactDetails({ landline: '04 123 4567' })).toThrow(
      'may not carry a telephone number',
    );
  });
});

describe('an id is not a way to ring anybody', () => {
  /**
   * The fault this closes (`docs/CHANGE-REQUESTS/assessment-01.md`, items 3
   * and 4). A uuid is thirty-two hexadecimal characters in five hyphenated
   * groups, and its letters cut the digits into shorter runs. Some of those
   * runs are nine to twelve digits beginning with a nought, which is exactly
   * what the check was looking for — so about one document id in eighty was
   * refused, `logAction` threw, and the request that carried it rolled back.
   * In production that is a practitioner's setup photograph failing to file,
   * at random, with no reason anyone can act on.
   *
   * Every id here was refused before this round, on the run named beside it.
   */
  const IDS_THE_CHECK_USED_TO_REFUSE = [
    ['eea04325-2317-4f6b-ada3-dd3a345ade00', '04325-2317-4'], // the change request's own
    ['09147553-5deb-4c1a-a7ec-d9a670f92e1f', '09147553-5'],
    ['f27ca5ea-d584-4d6b-95d0-f0679376378f', '0679376378'],
    ['01112578-192c-483d-b03a-90485d6ac233', '01112578-192'],
    ['de3f0169-5374-452d-aef5-f9902b118db8', '0169-5374-452'],
    ['a2533d07-4601-439a-881a-ef76a04b7929', '07-4601-439'],
    ['0d065905-9906-4b0b-8b95-b9f477145c36', '065905-9906-4'],
    ['a0896548-742b-41bf-ade0-c4b61aa5c30a', '0896548-742'],
    ['9921a075-9095-41d5-8a1f-39f1740a09d5', '075-9095-41'],
    // No letter beside the run at all: three whole groups of digits between
    // two hyphens. A rule that only asked what sits either side of a run
    // would still refuse this one, which is why the uuid is set aside first.
    ['abcdefab-0234-4567-8901-abcdefabcdef', '0234-4567-8901'],
  ] as const;

  it('lets through every id the check used to read as a telephone number', () => {
    for (const [id] of IDS_THE_CHECK_USED_TO_REFUSE) {
      expect(() => refuseContactDetails({ documentId: id })).not.toThrow();
    }
  });

  it('lets an id through wherever in a value it sits', () => {
    expect(() =>
      refuseContactDetails({
        alone: 'eea04325-2317-4f6b-ada3-dd3a345ade00',
        inASentence: 'filed as eea04325-2317-4f6b-ada3-dd3a345ade00 by the device',
        afterAnUnderscore: 'photo_eea04325-2317-4f6b-ada3-dd3a345ade00',
        shouted: 'EEA04325-2317-4F6B-ADA3-DD3A345ADE00',
        beside: 'eea04325-2317-4f6b-ada3-dd3a345ade00 and 01112578-192c-483d-b03a-90485d6ac233',
      }),
    ).not.toThrow();
  });

  it('lets through ten thousand ids of the shape the platform writes', () => {
    // The table above proves the ids that were caught; this proves the shape.
    // The source is seeded, so the ten thousand are the same ten thousand on
    // every run and any failure reproduces from the seed alone
    // (.claude/rules/testing.md: no randomness inside a test).
    const random = seededRandom(20260906);
    const refused: string[] = [];

    for (let i = 0; i < 10_000; i += 1) {
      const id = uuidFrom(random);
      try {
        refuseContactDetails({ documentId: id });
      } catch {
        refused.push(id);
      }
    }

    expect(refused).toEqual([]);
  });

  it('lets through every id in the reserved shapes', () => {
    // 0000000K-0000-4000-8000-* and 000000KK-0000-4000-8000-*, the two shapes
    // .claude/rules/testing.md reserves and db/seed/apply.ts enforces.
    const refused: string[] = [];

    for (let kind = 0; kind < 256; kind += 1) {
      const suffix = kind.toString(16).padStart(2, '0');
      for (const n of [0, 1, 7, 12, 99, 909, 1234]) {
        const tail = String(n).padStart(12, '0');
        for (const id of [
          `000000${suffix}-0000-4000-8000-${tail}`,
          `0000000${suffix.slice(1)}-0000-4000-8000-${tail}`,
        ]) {
          try {
            refuseContactDetails({ documentId: id });
          } catch {
            refused.push(id);
          }
        }
      }
    }

    expect(refused).toEqual([]);
  });

  it('still refuses a number written beside an id, so setting the id aside hides nothing', () => {
    expect(() =>
      refuseContactDetails({
        note: 'sent eea04325-2317-4f6b-ada3-dd3a345ade00 to +971 50 000 1234',
      }),
    ).toThrow('may not carry a telephone number');
  });
});

describe('the shapes the rule names, all of them still refused', () => {
  /**
   * The fix narrows what counts as a telephone number, so every shape the
   * rule names is asserted rather than assumed. The digits come from the
   * reserved fake ranges only (.claude/rules/testing.md): mobiles
   * +971 50 000 xxxx, Emirates IDs 784-1900-*.
   */
  const TELEPHONE_NUMBERS = [
    '+971 50 000 1234', // as a person writes it
    '+971500001234', // as a system strips it
    '0500001234', // local, bare
    '050 000 1234',
    '050-000-1234',
    '(050) 000 1234',
    '971500001234', // the country code without the plus
    '04 123 4567', // a landline
  ] as const;

  it('refuses every telephone shape, naming the key and never the number', () => {
    for (const number of TELEPHONE_NUMBERS) {
      expect(() => refuseContactDetails({ sentTo: number })).toThrow(
        'may not carry a telephone number; "sentTo" does',
      );
      expect(() => refuseContactDetails({ sentTo: number })).not.toThrow(number);
    }
  });

  it('refuses one inside a longer sentence, wherever in it the number sits', () => {
    for (const note of [
      'handed to +971 50 000 1234 at the door',
      '+971 50 000 1234 was the number given',
      'the number given was 050 000 1234',
    ]) {
      expect(() => refuseContactDetails({ note })).toThrow('may not carry a telephone number');
    }
  });

  it('refuses an Emirates ID, naming the key and never the number', () => {
    // Fifteen digits beginning 784 (domain/shared/emirates-id.ts). The rule
    // names it beside the telephone number, and section 8 of the spec keeps
    // it out of the trail for the same five years.
    const displayed = '784-1900-1234567-1';
    for (const id of [displayed, displayed.replace(/-/g, ' '), displayed.replace(/-/g, '')]) {
      expect(() => refuseContactDetails({ heldFor: id })).toThrow(
        'may not carry an Emirates ID; "heldFor" does',
      );
      expect(() => refuseContactDetails({ heldFor: id })).not.toThrow(id);
    }
  });

  it('refuses an email address, and leaves a figure, a reference and a date alone', () => {
    expect(() => refuseContactDetails({ sentTo: 'nobody@example.com' })).toThrow(
      'may not carry an email address',
    );
    expect(() =>
      refuseContactDetails({
        reference: 'INV-000012',
        grossFils: '103250',
        issuedOn: '2026-09-04',
        trn: '000000000000000',
        channel: 'whatsapp',
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
