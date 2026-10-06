import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asApiRole,
  freshDatabase,
  IDS,
  rejectsWith,
  rolledBack,
  seedTenant,
  setAuditContext,
} from './helpers';

/**
 * The website's reviews against a real database (db/migrations/978_testimonial.sql,
 * docs/SPEC/testimonials.md): what the door's definer admits and refuses, who
 * may read and decide a row, what the public read shows, how the retention
 * sweep deletes, and that a second practice sees none of it. Synthetic
 * throughout: seed names, no way to reach anybody.
 */

const SUBMIT = 'select app.submit_testimonial($1::jsonb) as id';
const PUBLISHED = 'select * from app.published_testimonials($1)';
const PURGE = 'select app.purge_stale_testimonials($1, $2) as deleted';
const COUNT = 'select count(*)::int as n from testimonial';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const INSUFFICIENT_PRIVILEGE = '42501';
const CHECK_VIOLATION = '23514';

function submission(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    display_name: 'Hazel H.',
    context: 'Parent, Dubai',
    rating: 5,
    body: 'The home visits fitted around our week, and the team explained every step.',
    language: 'en',
    consent_to_publish: true,
    ip_hash: HASH_A,
    ...overrides,
  });
}

let owner: pg.Client;

async function submit(overrides: Record<string, unknown> = {}): Promise<string | null> {
  const { rows } = await owner.query<{ id: string | null }>(SUBMIT, [submission(overrides)]);
  return rows[0]?.id ?? null;
}

/** A decision as the office makes one, written by the table's owner for the fixture. */
async function decide(
  id: string,
  status: 'approved' | 'declined',
  decidedAt = 'now()',
  order: number | null = null,
): Promise<void> {
  await owner.query(
    `update testimonial set status = $2, decided_by = $3, decided_at = ${decidedAt}, ` +
      'ip_hash = null, published_order = $4 where id = $1',
    [id, status, IDS.ownerA, order],
  );
}

beforeAll(async () => {
  owner = await freshDatabase();
  await seedTenant(owner, IDS.tenantA, IDS.ownerA, 'Practice A');
});

afterAll(async () => {
  await owner.end();
});

describe('the door', () => {
  it('lets the API role submit with no tenant and no actor stamped, and see nothing back', async () => {
    await rolledBack(owner, async () => {
      const seen = await asApiRole(
        owner,
        null,
        async () => {
          const { rows } = await owner.query<{ id: string | null }>(SUBMIT, [submission()]);
          expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
          const { rows: n } = await owner.query<{ n: number }>(COUNT);
          return n[0]?.n;
        },
        '',
      );
      expect(seen).toBe(0);
    });
  });

  it('files what the form gave, for the practice, waiting for the office', async () => {
    await rolledBack(owner, async () => {
      const id = await submit({ context: '' });
      const { rows } = await owner.query(
        'select tenant_id, status, display_name, context, rating, language, consent_to_publish, ' +
          'decided_by, published_order from testimonial where id = $1',
        [id],
      );
      expect(rows[0]).toEqual({
        tenant_id: IDS.tenantA,
        status: 'pending',
        display_name: 'Hazel H.',
        context: null,
        rating: 5,
        language: 'en',
        consent_to_publish: true,
        decided_by: null,
        published_order: null,
      });
    });
  });

  it('holds no column a person could be reached by', async () => {
    const { rows } = await owner.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'testimonial'",
    );
    const columns = rows.map((row) => row.column_name);
    for (const forbidden of ['email', 'phone', 'whatsapp_e164', 'name', 'client_id']) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it('refuses at the table what the door refuses, whoever the caller is', async () => {
    await rolledBack(owner, async () => {
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [
        submission({ consent_to_publish: false }),
      ]);
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [submission({ body: 'Too short.' })]);
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [submission({ body: 'a'.repeat(1201) })]);
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [submission({ rating: 6 })]);
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [submission({ language: 'fr' })]);
      await rejectsWith(owner, CHECK_VIOLATION, SUBMIT, [submission({ context: 'c'.repeat(61) })]);
    });
  });

  it('counts Arabic in characters, as the door does', async () => {
    await rolledBack(owner, async () => {
      expect(await submit({ body: 'ب'.repeat(1200), language: 'ar' })).not.toBeNull();
    });
  });

  it('answers null to the fourth submission from one address in ten minutes, and keeps three', async () => {
    await rolledBack(owner, async () => {
      for (let i = 0; i < 3; i += 1) expect(await submit()).not.toBeNull();
      expect(await submit()).toBeNull();
      // Another address is its own budget.
      expect(await submit({ ip_hash: HASH_B })).not.toBeNull();
      const { rows } = await owner.query<{ n: number }>(COUNT);
      expect(rows[0]?.n).toBe(4);
    });
  });

  it('keeps nothing when there is not exactly one practice to file it for', async () => {
    await rolledBack(owner, async () => {
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Practice B');
      expect(await submit()).toBeNull();
      const { rows } = await owner.query<{ n: number }>(COUNT);
      expect(rows[0]?.n).toBe(0);
    });
  });

  it('gives the API role no insert of its own: the definer is the one way in', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(owner, IDS.tenantA, async () => {
        await rejectsWith(
          owner,
          INSUFFICIENT_PRIVILEGE,
          'insert into testimonial (tenant_id, display_name, rating, body, language, consent_to_publish, ip_hash) ' +
            "values ($1, 'Hazel H.', 5, $2, 'en', true, $3)",
          [IDS.tenantA, 'x'.repeat(40), HASH_A],
        );
      });
    });
  });
});

describe('who reads and decides', () => {
  it('shows the rows to the owner and an admin, and to nobody else', async () => {
    await rolledBack(owner, async () => {
      await submit();
      for (const roles of ['owner', 'admin']) {
        const n = await asApiRole(
          owner,
          IDS.tenantA,
          async () => (await owner.query<{ n: number }>(COUNT)).rows[0]?.n,
          roles,
        );
        expect(n, roles).toBe(1);
      }
      for (const roles of ['lead_practitioner', 'practitioner', 'finance', 'client_contact']) {
        const n = await asApiRole(
          owner,
          IDS.tenantA,
          async () => (await owner.query<{ n: number }>(COUNT)).rows[0]?.n,
          roles,
        );
        expect(n, roles).toBe(0);
      }
    });
  });

  it('lets an admin approve, decline and withdraw, and nothing more', async () => {
    await rolledBack(owner, async () => {
      const first = await submit();
      const second = await submit({ ip_hash: HASH_B });
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await setAuditContext(owner, IDS.ownerA);
          const approved = await owner.query(
            "update testimonial set status = 'approved', decided_by = $2, decided_at = now(), ip_hash = null where id = $1",
            [first, IDS.ownerA],
          );
          expect(approved.rowCount).toBe(1);
          // Arranged on the page.
          const ordered = await owner.query(
            'update testimonial set published_order = 1 where id = $1',
            [first],
          );
          expect(ordered.rowCount).toBe(1);
          // Withdrawn: approved to declined, by whoever withdrew it, from now.
          const withdrawn = await owner.query(
            "update testimonial set status = 'declined', decided_by = $2, decided_at = now(), published_order = null where id = $1",
            [first, IDS.ownerA],
          );
          expect(withdrawn.rowCount).toBe(1);
          // A declined review is never brought back: the row admits no update.
          const revived = await owner.query(
            "update testimonial set status = 'approved' where id = $1",
            [first],
          );
          expect(revived.rowCount).toBe(0);
          // Nobody edits what somebody wrote, not even the office.
          await rejectsWith(
            owner,
            CHECK_VIOLATION,
            'update testimonial set body = $2 where id = $1',
            [second, 'Edited by the office to say something kinder.'],
          );
          await rejectsWith(
            owner,
            CHECK_VIOLATION,
            'update testimonial set display_name = $2 where id = $1',
            [second, 'Someone Else'],
          );
          // No delete of its own: retention is the sweep's.
          await rejectsWith(
            owner,
            INSUFFICIENT_PRIVILEGE,
            'delete from testimonial where id = $1',
            [second],
          );
        },
        'admin',
      );
    });
  });

  it('refuses a decision from the lead practitioner at the row', async () => {
    await rolledBack(owner, async () => {
      const id = await submit();
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const res = await owner.query(
            "update testimonial set status = 'approved', decided_by = $2, decided_at = now(), ip_hash = null where id = $1",
            [id, IDS.ownerA],
          );
          expect(res.rowCount).toBe(0);
        },
        'lead_practitioner',
      );
    });
  });

  it('insists a decided review names who decided and when, and forgets the address', async () => {
    await rolledBack(owner, async () => {
      const id = await submit();
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update testimonial set status = 'approved' where id = $1",
        [id],
      );
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update testimonial set status = 'approved', decided_by = $2, decided_at = now() where id = $1",
        [id, IDS.ownerA],
      );
      // A place on the page is for an approved review only.
      await rejectsWith(
        owner,
        CHECK_VIOLATION,
        "update testimonial set status = 'declined', decided_by = $2, decided_at = now(), ip_hash = null, published_order = 1 where id = $1",
        [id, IDS.ownerA],
      );
    });
  });
});

describe('the public read', () => {
  it('shows approved reviews only, in the language asked, ordered as the office arranged them', async () => {
    await rolledBack(owner, async () => {
      const waiting = await submit({ display_name: 'Rowan M.' });
      const declined = await submit({ display_name: 'Iris C.' });
      const older = await submit({ display_name: 'Basil V.', ip_hash: HASH_B });
      const newer = await submit({ display_name: 'Hazel V.', ip_hash: HASH_B });
      const placed = await submit({ display_name: 'Pearl C.', ip_hash: HASH_B });
      const arabic = await submit({
        display_name: 'بندق م.',
        language: 'ar',
        ip_hash: 'c'.repeat(64),
      });
      expect(waiting).not.toBeNull();
      await decide(declined!, 'declined');
      await decide(older!, 'approved', "now() - interval '2 days'");
      await decide(newer!, 'approved', "now() - interval '1 day'");
      await decide(placed!, 'approved', "now() - interval '3 days'", 1);
      await decide(arabic!, 'approved');

      const english = await asApiRole(
        owner,
        null,
        async () => (await owner.query(PUBLISHED, ['en'])).rows,
        '',
      );
      // Approved since the list was last arranged, newest decision first, so
      // the office sees at once what it just approved; then the arranged ones
      // in their places.
      expect(english.map((row) => row.display_name)).toEqual(['Hazel V.', 'Basil V.', 'Pearl C.']);
      // Four fields and nothing else: no id, no date.
      expect(Object.keys(english[0] ?? {}).sort()).toEqual([
        'body',
        'context',
        'display_name',
        'rating',
      ]);

      const inArabic = await asApiRole(
        owner,
        null,
        async () => (await owner.query(PUBLISHED, ['ar'])).rows,
        '',
      );
      expect(inArabic.map((row) => row.display_name)).toEqual(['بندق م.']);
    });
  });

  it('sends thirty at most', async () => {
    await rolledBack(owner, async () => {
      for (let i = 0; i < 32; i += 1) {
        const id = await submit({ ip_hash: `${String(i).padStart(2, '0')}${'d'.repeat(62)}` });
        await decide(id!, 'approved');
      }
      const { rows } = await owner.query(PUBLISHED, ['en']);
      expect(rows).toHaveLength(30);
    });
  });

  it('shows nothing when there is not exactly one practice', async () => {
    await rolledBack(owner, async () => {
      const id = await submit();
      await decide(id!, 'approved');
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Practice B');
      const { rows } = await owner.query(PUBLISHED, ['en']);
      expect(rows).toEqual([]);
    });
  });
});

describe('tenant isolation', () => {
  it("never shows one practice's reviews to another's office", async () => {
    await rolledBack(owner, async () => {
      await submit();
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Practice B');
      const n = await asApiRole(
        owner,
        IDS.tenantB,
        async () => (await owner.query<{ n: number }>(COUNT)).rows[0]?.n,
        'owner',
      );
      expect(n).toBe(0);
    });
  });
});

describe('the retention sweep', () => {
  it('deletes a declined review after thirty days and a waiting one after a hundred and eighty, and keeps every approved one', async () => {
    await rolledBack(owner, async () => {
      // When a review arrived never changes (the guard), so the old ones are
      // written in as old by the table's owner, which the door never is.
      const arrivedLongAgo = async (displayName: string, hash: string): Promise<string> => {
        const { rows } = await owner.query<{ id: string }>(
          'insert into testimonial (tenant_id, submitted_at, display_name, rating, body, language, ' +
            "consent_to_publish, ip_hash) values ($1, now() - interval '400 days', $2, 4, $3, 'en', true, $4) " +
            'returning id',
          [IDS.tenantA, displayName, 'Kind, punctual and clear about every step.', hash],
        );
        return rows[0]!.id;
      };
      const oldDeclined = await arrivedLongAgo('Iris C.', HASH_A);
      const freshDeclined = await submit({ display_name: 'Rowan M.' });
      const oldApproved = await arrivedLongAgo('Basil V.', HASH_A);
      // Waiting since long ago: due to go.
      await arrivedLongAgo('Hazel V.', HASH_B);
      const freshPending = await submit({ display_name: 'Pearl C.', ip_hash: HASH_B });
      await decide(oldDeclined!, 'declined', "now() - interval '31 days'");
      await decide(freshDeclined!, 'declined', "now() - interval '29 days'");
      await decide(oldApproved!, 'approved', "now() - interval '399 days'");

      // Read back inside the same savepoint, which asApiRole rolls back.
      const { deleted, left } = await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          const { rows } = await owner.query<{ deleted: number }>(PURGE, [
            new Date(Date.now() - 30 * 86_400_000),
            new Date(Date.now() - 180 * 86_400_000),
          ]);
          const after = await owner.query<{ id: string }>('select id from testimonial');
          return { deleted: rows[0]?.deleted, left: after.rows.map((row) => row.id) };
        },
        'admin',
      );
      expect(deleted).toBe(2);
      expect(left.sort()).toEqual([freshDeclined, oldApproved, freshPending].sort());
    });
  });

  it('refuses a cutoff that would delete sooner than the promise, and a caller who is not the office', async () => {
    await rolledBack(owner, async () => {
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await rejectsWith(owner, CHECK_VIOLATION, PURGE, [
            new Date(),
            new Date(Date.now() - 180 * 86_400_000),
          ]);
          await rejectsWith(owner, CHECK_VIOLATION, PURGE, [
            new Date(Date.now() - 30 * 86_400_000),
            new Date(Date.now() - 179 * 86_400_000),
          ]);
        },
        'admin',
      );
      await asApiRole(
        owner,
        IDS.tenantA,
        async () => {
          await rejectsWith(owner, INSUFFICIENT_PRIVILEGE, PURGE, [
            new Date(Date.now() - 30 * 86_400_000),
            new Date(Date.now() - 180 * 86_400_000),
          ]);
        },
        'practitioner',
      );
    });
  });

  it("deletes only the stamped practice's rows", async () => {
    await rolledBack(owner, async () => {
      const id = await submit();
      await decide(id!, 'declined', "now() - interval '40 days'");
      await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Practice B');
      const deleted = await asApiRole(
        owner,
        IDS.tenantB,
        async () =>
          (
            await owner.query<{ deleted: number }>(PURGE, [
              new Date(Date.now() - 30 * 86_400_000),
              new Date(Date.now() - 180 * 86_400_000),
            ])
          ).rows[0]?.deleted,
        'admin',
      );
      expect(deleted).toBe(0);
    });
  });
});
