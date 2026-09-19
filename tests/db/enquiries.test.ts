import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asApiRole,
  freshDatabase,
  IDS,
  rejectsWith,
  rolledBack,
  seedClient,
  seedTenant,
  setAuditContext,
} from './helpers';

/**
 * The quarantine and its one door (db/migrations/916_enquiry.sql), against a
 * real database: what app.lodge_enquiry admits and refuses, who may read a row,
 * that nothing inserts directly, and that an actioned row keeps nothing.
 */

const LODGE = 'select app.lodge_enquiry($1::jsonb) as id';
const COUNT = 'select count(*)::text as n from enquiry';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

function lodging(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    source: 'website',
    name: 'Hazel Harbour',
    whatsapp_e164: '+971500000099',
    email: 'hazel@example.com',
    area: 'Jumeirah',
    message: 'I want to know more',
    consent: 'true',
    ip_hash: HASH_A,
    ...overrides,
  });
}

const SCRUB =
  'name = null, whatsapp_e164 = null, email = null, area = null, message = null, ' +
  'concern = null, preferred_time = null, contact_method = null, consent = null, ip_hash = null, ' +
  'enquiring_for = null, interest = null, marketing_opt_in = null';
/**
 * A dismissal that keeps the person keeps how to reach them, and not what they
 * wrote (the operator's decision of 19 September 2026): the address hash goes,
 * which has no follow-up purpose, and so do the two free-text answers, which
 * is where somebody writes about themselves or their child.
 */
const KEEP = 'ip_hash = null, message = null, concern = null';

/** What the expo form on the app sends (migration 919): the two answers, no country code. */
function expoLodging(overrides: Record<string, unknown> = {}): string {
  return lodging({
    source: 'expo',
    name: 'Rowan Meadow',
    whatsapp_e164: '+971500000098',
    email: '',
    area: 'Mirdif',
    message: 'Saw the stand',
    enquiring_for: 'child',
    interest: 'both',
    ip_hash: HASH_B,
    ...overrides,
  });
}

let owner: pg.Client;

async function countAs(tenantId: string | null, roles: string): Promise<string> {
  return asApiRole(
    owner,
    tenantId,
    async () => {
      const { rows } = await owner.query<{ n: string }>(COUNT);
      return rows[0]?.n ?? '';
    },
    roles,
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Practice A');
});

afterAll(async () => {
  await owner.end();
});

describe('lodging through the door', () => {
  it('lets the API role lodge with no tenant and no actor stamped — and see nothing back', async () => {
    // The door's own situation: a stranger pressed Send, the fence has not
    // run, and only a request id is stamped. The definer resolves the practice
    // itself; the caller, with no tenant in context, is shown no row at all.
    await rolledBack(owner, async () => {
      const seen = await asApiRole(
        owner,
        null,
        async () => {
          const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
          expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
          const { rows: n } = await owner.query<{ n: string }>(COUNT);
          return n[0]?.n;
        },
        '',
      );
      expect(seen).toBe('0');
    });
  });

  it('files what the form gave, for the practice', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [lodging()]);
      const { rows: read } = await owner.query(
        'select tenant_id, status, name, whatsapp_e164, consent, source, actioned_by from enquiry where id = $1',
        [rows[0]?.id],
      );
      expect(read[0]).toEqual({
        tenant_id: IDS.tenantA,
        status: 'new',
        name: 'Hazel Harbour',
        whatsapp_e164: '+971500000099',
        consent: true,
        source: 'website',
        actioned_by: null,
      });
    });
  });

  it('keeps consent three-valued: absent is never asked, not refused', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [lodging({ consent: undefined })]);
      const { rows: read } = await owner.query('select consent from enquiry where id = $1', [
        rows[0]?.id,
      ]);
      expect(read[0]?.consent).toBeNull();
    });
  });

  it('refuses the sixth lodging from one address in ten minutes, and says so to nobody', async () => {
    await rolledBack(owner, async () => {
      for (let i = 0; i < 5; i += 1) {
        const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
        expect(rows[0]?.id, `lodging ${i + 1}`).not.toBeNull();
      }
      const { rows: sixth } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
      expect(sixth[0]?.id).toBeNull();
      // Another address is not throttled by the first one's budget.
      const { rows: other } = await owner.query<{ id: string | null }>(LODGE, [
        lodging({ ip_hash: HASH_B }),
      ]);
      expect(other[0]?.id).not.toBeNull();
      const { rows: n } = await owner.query<{ n: string }>(COUNT);
      expect(n[0]?.n).toBe('6');
    });
  });

  it('lodges nothing on a database that is not exactly one practice', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, IDS.ownerA, 'a second practice');
      await owner.query("insert into tenant (id, legal_name) values ($1, 'Practice B')", [
        IDS.tenantB,
      ]);
      const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
      expect(rows[0]?.id).toBeNull();
    });
  });

  it('files an expo enquiry with its two answers', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [expoLodging()]);
      const { rows: read } = await owner.query(
        'select source, status, enquiring_for, interest, email from enquiry where id = $1',
        [rows[0]?.id],
      );
      expect(read[0]).toEqual({
        source: 'expo',
        status: 'new',
        enquiring_for: 'child',
        interest: 'both',
        email: null,
      });
    });
  });

  it('refuses a new expo enquiry that does not say who or what, at the table itself', async () => {
    // The door parses before it lodges; this is the table's own guarantee,
    // which holds whoever the caller is.
    await rolledBack(owner, async () => {
      await rejectsWith(owner, CHECK_VIOLATION, LODGE, [expoLodging({ interest: '' })]);
      await rejectsWith(owner, CHECK_VIOLATION, LODGE, [expoLodging({ enquiring_for: 'my dog' })]);
      // The website's rows never carry the two answers and are not asked to.
      const { rows } = await owner.query<{ id: string | null }>(LODGE, [lodging()]);
      expect(rows[0]?.id).not.toBeNull();
      await rejectsWith(owner, CHECK_VIOLATION, LODGE, [lodging({ interest: 'both' })]);
    });
  });

  it('refuses the three hundred and first lodging of the hour from every address together, and says so to nobody', async () => {
    // The ceiling of the practice's own: a script that says 'expo' from many
    // addresses gets the stand's budget from each, and this is what bounds it.
    await rolledBack(owner, async () => {
      for (let i = 0; i < 300; i += 1) {
        const hash = i.toString(16).padStart(64, '0');
        const { rows } = await owner.query<{ id: string | null }>(LODGE, [
          expoLodging({ ip_hash: hash }),
        ]);
        expect(rows[0]?.id, `lodging ${i + 1}`).not.toBeNull();
      }
      const { rows: over } = await owner.query<{ id: string | null }>(LODGE, [
        expoLodging({ ip_hash: 'f'.repeat(64) }),
      ]);
      expect(over[0]?.id).toBeNull();
      const { rows: site } = await owner.query<{ id: string | null }>(LODGE, [
        lodging({ ip_hash: 'e'.repeat(64) }),
      ]);
      expect(site[0]?.id).toBeNull();
    });
  });

  it('allows thirty expo lodgings from one address in ten minutes, and still five from the website', async () => {
    await rolledBack(owner, async () => {
      for (let i = 0; i < 30; i += 1) {
        const { rows } = await owner.query<{ id: string | null }>(LODGE, [expoLodging()]);
        expect(rows[0]?.id, `expo lodging ${i + 1}`).not.toBeNull();
      }
      const { rows: thirtyFirst } = await owner.query<{ id: string | null }>(LODGE, [
        expoLodging(),
      ]);
      expect(thirtyFirst[0]?.id).toBeNull();
      // The same address, through the website's form, is held to the website's five.
      const { rows: site } = await owner.query<{ id: string | null }>(LODGE, [
        lodging({ ip_hash: HASH_B }),
      ]);
      expect(site[0]?.id).toBeNull();
    });
  });

  it('gives the API role no way to insert directly', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        () =>
          rejectsWith(
            owner,
            INSUFFICIENT_PRIVILEGE,
            "insert into enquiry (tenant_id, source, name, whatsapp_e164, ip_hash) values ($1, 'website', 'x', '+971500000098', $2)",
            [IDS.tenantA, HASH_A],
          ),
        'owner',
      );
    });
  });
});

describe('who may read and action', () => {
  async function lodgeOne(): Promise<string> {
    const { rows } = await owner.query<{ id: string }>(LODGE, [lodging()]);
    return rows[0]!.id;
  }

  it('shows the row to the owner, an admin and the lead practitioner, and to nobody else', async () => {
    await rolledBack(owner, async () => {
      await lodgeOne();
      for (const roles of ['owner', 'admin', 'lead_practitioner']) {
        expect(await countAs(IDS.tenantA, roles), roles).toBe('1');
      }
      for (const roles of ['practitioner', 'finance']) {
        expect(await countAs(IDS.tenantA, roles), roles).toBe('0');
      }
    });
  });

  it('shows another practice nothing', async () => {
    await rolledBack(owner, async () => {
      await lodgeOne();
      expect(await countAs(IDS.tenantB, 'owner')).toBe('0');
    });
  });

  it('scrubs the two answers with the rest when actioned', async () => {
    await rolledBack(owner, async () => {
      const { rows } = await owner.query<{ id: string }>(LODGE, [expoLodging()]);
      const id = rows[0]!.id;
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          // 916's scrub, without the two new names, is refused by the table.
          await rejectsWith(
            owner,
            CHECK_VIOLATION,
            "update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, " +
              'name = null, whatsapp_e164 = null, email = null, area = null, message = null, ' +
              'concern = null, preferred_time = null, contact_method = null, consent = null, ip_hash = null ' +
              'where id = $1',
            [id, IDS.ownerA],
          );
          const { rowCount } = await owner.query(
            `update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
            [id, IDS.ownerA],
          );
          expect(rowCount).toBe(1);
          // Read inside the same savepoint: asApiRole rolls it back on the way out.
          const { rows: read } = await owner.query(
            'select enquiring_for, interest from enquiry where id = $1',
            [id],
          );
          expect(read[0]).toEqual({ enquiring_for: null, interest: null });
        },
        'admin',
      );
    });
  });

  it('lets an admin dismiss a new enquiry, and only by scrubbing every personal field', async () => {
    await rolledBack(owner, async () => {
      const id = await lodgeOne();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          // Half a scrub is refused by the table itself, not by a route remembering.
          await rejectsWith(
            owner,
            CHECK_VIOLATION,
            "update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, whatsapp_e164 = null, ip_hash = null where id = $1",
            [id, IDS.ownerA],
          );
          const { rowCount } = await owner.query(
            `update enquiry set status = 'dismissed', dismiss_reason = 'spam', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
            [id, IDS.ownerA],
          );
          expect(rowCount).toBe(1);
        },
        'admin',
      );
    });
  });

  it('touches nothing for a practitioner, and nothing already actioned', async () => {
    await rolledBack(owner, async () => {
      const id = await lodgeOne();
      const asPractitioner = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rowCount } = await owner.query(
            `update enquiry set status = 'dismissed', dismiss_reason = 'x', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
            [id, IDS.ownerA],
          );
          return rowCount;
        },
        'practitioner',
      );
      expect(asPractitioner).toBe(0);

      await owner.query(
        `update enquiry set status = 'dismissed', dismiss_reason = 'done', actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
        [id, IDS.ownerA],
      );
      const again = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rowCount } = await owner.query(
            "update enquiry set dismiss_reason = 'changed my mind' where id = $1",
            [id],
          );
          return rowCount;
        },
        'admin',
      );
      // An actioned row admits no second action: the policy's `using` is status = new.
      expect(again).toBe(0);
    });
  });
});

/**
 * The operator's decision of 19 September 2026: a dismissed enquiry keeps its
 * details, so the practice can follow up or, where the person asked for it,
 * send them its news. Kept only for a person who was told it would be
 * (docs/superpowers/plans/2026-09-19-enquiries-keep-details.md).
 */
describe('what is kept, and for whom', () => {
  const lodgeWith = async (overrides: Record<string, unknown>): Promise<string> => {
    const { rows } = await owner.query<{ id: string }>(LODGE, [lodging(overrides)]);
    return rows[0]!.id;
  };
  const dismissAs = (set: string) =>
    `update enquiry set status = 'dismissed', dismiss_reason = 'Not now', actioned_at = now(), actioned_by = $2, ${set} where id = $1`;

  it('remembers which wording a person read, and takes a form that does not say for the earlier one', async () => {
    await rolledBack(owner, async () => {
      const told = await lodgeWith({
        notice_version: '2',
        marketing_opt_in: 'true',
        ip_hash: HASH_A,
      });
      const toldNo = await lodgeWith({ notice_version: '2', ip_hash: HASH_B });
      const silent = await lodgeWith({ ip_hash: 'c'.repeat(64) });
      // Anything but a plain 2 is the earlier wording: the safe reading of a form we do not know.
      const odd = await lodgeWith({
        notice_version: '7',
        marketing_opt_in: 'true',
        ip_hash: 'd'.repeat(64),
      });
      const { rows } = await owner.query<{
        id: string;
        notice_version: number;
        marketing_opt_in: boolean | null;
      }>('select id, notice_version, marketing_opt_in from enquiry where id = any($1::uuid[])', [
        [told, toldNo, silent, odd],
      ]);
      const of = (id: string) => rows.find((row) => row.id === id);
      expect(of(told)).toMatchObject({ notice_version: 2, marketing_opt_in: true });
      // Asked, and did not tick: a refusal, which is not the same as never asked.
      expect(of(toldNo)).toMatchObject({ notice_version: 2, marketing_opt_in: false });
      expect(of(silent)).toMatchObject({ notice_version: 1, marketing_opt_in: null });
      // Never asked, whatever the payload claimed: the earlier wording had no such tick.
      expect(of(odd)).toMatchObject({ notice_version: 1, marketing_opt_in: null });
    });
  });

  it('keeps a dismissed person only if they were told it would, and never their address hash', async () => {
    await rolledBack(owner, async () => {
      // With both free-text answers filled, so that keeping either one is a thing that can be tried.
      const told = await lodgeWith({
        notice_version: '2',
        marketing_opt_in: 'true',
        concern: 'Sleep',
      });
      // The hash has no follow-up purpose: kept with the rest, it is refused.
      await rejectsWith(owner, CHECK_VIOLATION, dismissAs('email = email'), [told, IDS.ownerA]);
      // Nor what they wrote: a kept person is how to reach them, not what they confided.
      await rejectsWith(owner, CHECK_VIOLATION, dismissAs('ip_hash = null'), [told, IDS.ownerA]);
      await rejectsWith(owner, CHECK_VIOLATION, dismissAs('ip_hash = null, message = null'), [
        told,
        IDS.ownerA,
      ]);
      const kept = await owner.query(dismissAs(KEEP), [told, IDS.ownerA]);
      expect(kept.rowCount).toBe(1);
      const { rows } = await owner.query(
        'select name, whatsapp_e164, email, area, marketing_opt_in, ip_hash, message, concern from enquiry where id = $1',
        [told],
      );
      expect(rows[0]).toEqual({
        name: 'Hazel Harbour',
        whatsapp_e164: '+971500000099',
        email: 'hazel@example.com',
        area: 'Jumeirah',
        marketing_opt_in: true,
        ip_hash: null,
        message: null,
        concern: null,
      });
    });
    await rolledBack(owner, async () => {
      // Told "keeps nothing personal": the table itself refuses to keep them.
      const promised = await lodgeWith({});
      await rejectsWith(owner, CHECK_VIOLATION, dismissAs(KEEP), [promised, IDS.ownerA]);
      expect((await owner.query(dismissAs(SCRUB), [promised, IDS.ownerA])).rowCount).toBe(1);
    });
    await rolledBack(owner, async () => {
      // A lead is on the client record from that moment, whichever wording they read.
      const told = await lodgeWith({ notice_version: '2' });
      await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        `update enquiry set status = 'converted', client_id = $3, actioned_at = now(), actioned_by = $2, ${KEEP} where id = $1`,
        [told, IDS.ownerA, IDS.clientA],
      );
    });
  });

  it('never lets the earlier wording become the later one, waiting or in the statement that dismisses', async () => {
    // The whole rule hangs from this: a person promised that an enquiry keeps
    // nothing must not be made keepable by anybody, the table's owner included.
    await rolledBack(owner, async () => {
      const promised = await lodgeWith({});
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        'update enquiry set notice_version = 2 where id = $1',
        [promised],
      );
      await rejectsWith(owner, CHECK_VIOLATION, dismissAs(`${KEEP}, notice_version = 2`), [
        promised,
        IDS.ownerA,
      ]);
    });
  });

  it('lets a dismissed row change in one way only: its person erased', async () => {
    await rolledBack(owner, async () => {
      const id = await lodgeWith({ notice_version: '2', marketing_opt_in: 'true' });
      await owner.query(dismissAs(KEEP), [id, IDS.ownerA]);
      // Not back to life, not onto a client, not a different reason, not different details.
      for (const change of [
        "status = 'new', dismiss_reason = null, actioned_at = null, actioned_by = null, ip_hash = 'e'",
        "dismiss_reason = 'Something else'",
        "name = 'Rowan Meadow'",
        'marketing_opt_in = false',
        'notice_version = 1',
      ]) {
        await rejectsWith(owner, CHECK_VIOLATION, `update enquiry set ${change} where id = $1`, [
          id,
        ]);
      }
      expect((await owner.query(`update enquiry set ${SCRUB} where id = $1`, [id])).rowCount).toBe(
        1,
      );
      // And once erased, erased: nobody writes a person back onto the row.
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set name = 'Hazel Harbour', whatsapp_e164 = '+971500000099' where id = $1",
        [id],
      );
    });
  });

  it('takes a person as the form gave them: nothing is edited on the way to dismissed, or before', async () => {
    // A tick slipped in, or a name and number swapped, in the same statement
    // that dismisses: the constraints would accept either, so the trigger must not.
    for (const change of [
      'marketing_opt_in = true',
      "name = 'Rowan Meadow', whatsapp_e164 = '+971500000098'",
      "email = 'rowan@example.com'",
    ]) {
      await rolledBack(owner, async () => {
        const id = await lodgeWith({ notice_version: '2', marketing_opt_in: 'false' });
        await rejectsWith(owner, CHECK_VIOLATION, dismissAs(`${KEEP}, ${change}`), [
          id,
          IDS.ownerA,
        ]);
        // Nor while it waits.
        await rejectsWith(owner, CHECK_VIOLATION, `update enquiry set ${change} where id = $1`, [
          id,
        ]);
      });
    }
    await rolledBack(owner, async () => {
      // Where it came from and when do not change either.
      const id = await lodgeWith({ notice_version: '2' });
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set source = 'discovery_call' where id = $1",
        [id],
      );
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set received_at = now() - interval '1 year' where id = $1",
        [id],
      );
      // And the two things that are meant to happen still do.
      expect((await owner.query(dismissAs(KEEP), [id, IDS.ownerA])).rowCount).toBe(1);
    });
  });

  it('lets what a person wrote go, and never be rewritten, waiting or kept', async () => {
    // The relaxed half of "never edited": the two free-text answers may go to
    // null while the person stays. The other half, that they are never
    // rewritten, is the trigger's alone while a row waits, so it is tried here
    // by itself. (Not in the loop above: beside KEEP these would be a duplicate
    // assignment, which is a syntax error and not the refusal being tested.)
    await rolledBack(owner, async () => {
      const id = await lodgeWith({ notice_version: '2', concern: 'Sleep' });
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set message = 'Not what they wrote' where id = $1",
        [id],
      );
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set concern = 'Other' where id = $1",
        [id],
      );
      await owner.query(dismissAs(KEEP), [id, IDS.ownerA]);
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set message = 'Back again' where id = $1",
        [id],
      );
    });
  });

  it('holds an actioned row as it was for the table’s owner too, a lead as much as a dismissal', async () => {
    await rolledBack(owner, async () => {
      // Before migration 921 a constraint made a person on ANY actioned row
      // impossible for every role. The trigger has to hold the same for a
      // converted row, which the API role cannot reach but the owner can.
      const id = await lodgeWith({ notice_version: '2' });
      await seedClient(owner, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
      await owner.query(
        `update enquiry set status = 'converted', client_id = $3, actioned_at = now(), actioned_by = $2, ${SCRUB} where id = $1`,
        [id, IDS.ownerA, IDS.clientA],
      );
      for (const change of [
        // Turned into a dismissal, with a person written back onto it.
        "status = 'dismissed', client_id = null, dismiss_reason = 'x', name = 'Hazel Harbour', whatsapp_e164 = '+971500000099'",
        // Brought back to life.
        "status = 'new', client_id = null, actioned_at = null, actioned_by = null, name = 'Hazel Harbour', whatsapp_e164 = '+971500000099', ip_hash = 'e'",
        'client_id = null',
        "actioned_at = now() - interval '1 day'",
        "created_at = now() - interval '1 year'",
      ]) {
        await rejectsWith(owner, CHECK_VIOLATION, `update enquiry set ${change} where id = $1`, [
          id,
        ]);
      }
    });
  });

  it('is not switched off by a session that replays changes', async () => {
    // `session_replication_role = replica` skips ordinary triggers. This one is
    // `enable always`, like the repository's other guards, or "the owner too" is not true.
    await rolledBack(owner, async () => {
      const id = await lodgeWith({ notice_version: '2' });
      await owner.query(dismissAs(KEEP), [id, IDS.ownerA]);
      await owner.query("set local session_replication_role = 'replica'");
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update enquiry set name = 'Rowan Meadow' where id = $1",
        [id],
      );
    });
  });

  it('lets an admin erase a kept person, a practitioner nothing, and nobody touch a scrubbed row', async () => {
    await rolledBack(owner, async () => {
      const kept = await lodgeWith({ notice_version: '2', ip_hash: HASH_A });
      const gone = await lodgeWith({ ip_hash: HASH_B });
      await owner.query(dismissAs(KEEP), [kept, IDS.ownerA]);
      await owner.query(dismissAs(SCRUB), [gone, IDS.ownerA]);
      const erase = (id: string) => owner.query(`update enquiry set ${SCRUB} where id = $1`, [id]);

      const byPractitioner = await asApiRole(
        owner,
        IDS.tenantA,
        async () => (await erase(kept)).rowCount,
        'practitioner',
      );
      expect(byPractitioner).toBe(0);
      // A row with nobody left on it is not the API role's to update at all, as before.
      const scrubbedRow = await asApiRole(
        owner,
        IDS.tenantA,
        async () => (await erase(gone)).rowCount,
        'admin',
      );
      expect(scrubbedRow).toBe(0);
      // Read inside the same role's block: `asApiRole` rolls its work back
      // when it returns, so a read made afterwards sees the row as it was.
      const byAdmin = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rowCount } = await erase(kept);
          const { rows } = await owner.query(
            'select name, status, dismiss_reason from enquiry where id = $1',
            [kept],
          );
          return { rowCount, row: rows[0] };
        },
        'admin',
      );
      expect(byAdmin.rowCount).toBe(1);
      expect(byAdmin.row).toEqual({ name: null, status: 'dismissed', dismiss_reason: 'Not now' });
    });
  });
});
