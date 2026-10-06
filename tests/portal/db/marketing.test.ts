import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  asApiRole,
  freshDatabase,
  rolledBack,
  seedTenant,
  setAuditContext,
} from '../../db/helpers';
import { PORTAL, asContact, seedConsent, seedPortalHousehold, seedWording } from './support';

/**
 * The marketing consent's floor (migration 706; the push memo's decision 1;
 * docs/CONSENT/marketing.en.md).
 *
 * The household has no write on `consent`; the switch is two functions, each
 * for this one purpose, as the person signed in and for nobody else. Read as
 * `app_role` with each person's own stamp, which is what a request is. Every
 * row here is invented and names nobody.
 */

const RLS_VIOLATION = '42501';
const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';

const W = {
  en: '00000001-0000-4000-8000-0000000000a1',
  ar: '00000001-0000-4000-8000-0000000000a2',
  retired: '00000001-0000-4000-8000-0000000000a3',
  draft: '00000001-0000-4000-8000-0000000000a4',
  participation: '00000001-0000-4000-8000-0000000000a5',
  otherPractice: '00000001-0000-4000-8000-0000000000a6',
} as const;

let owner: pg.Client;

beforeAll(async () => {
  owner = await freshDatabase();
  await seedPortalHousehold(owner);
  await seedTenant(owner, IDS.tenantB, IDS.ownerB, 'Another Studio');
  await seedWording(owner, {
    id: W.retired,
    purpose: 'marketing',
    locale: 'en',
    version: '0.9',
    status: 'approved',
    retired: true,
  });
  await seedWording(owner, {
    id: W.en,
    purpose: 'marketing',
    locale: 'en',
    version: '1.0',
    status: 'approved',
  });
  await seedWording(owner, {
    id: W.ar,
    purpose: 'marketing',
    locale: 'ar',
    version: '1.0',
    status: 'approved',
  });
  await seedWording(owner, {
    id: W.draft,
    purpose: 'marketing',
    locale: 'en',
    version: '1.1-draft',
    status: 'draft',
  });
  await seedWording(owner, {
    id: W.participation,
    purpose: 'participation',
    locale: 'en',
    version: '1.0',
    status: 'approved',
  });
  await owner.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
      "is_immutable, purpose, locale, version, status) values ($1, $2, null, 'consent_text', " +
      "$3, 'text/markdown', sha256(convert_to($3, 'UTF8')), true, 'marketing', 'en', '1.0', " +
      "'approved')",
    [W.otherPractice, IDS.tenantB, `tenant/${IDS.tenantB}/practice/${W.otherPractice}`],
  );
});

afterAll(async () => {
  await owner?.end();
});

/**
 * As one person, stamped as themselves, whose writes stand until the test's
 * own transaction is rolled back. `asContact` rolls its savepoint back as it
 * returns, which proves a read and discards a write; the switch is a write.
 */
async function as<T>(userId: string, fn: () => Promise<T>, roles = 'client_contact'): Promise<T> {
  await setAuditContext(owner, userId, 'Turned offers on');
  await owner.query('set local role app_role');
  await owner.query(
    "select set_config('app.tenant_id', $1, true), set_config('app.actor_roles', $2, true)",
    [IDS.tenantA, roles],
  );
  try {
    return await fn();
  } finally {
    await owner.query('reset role');
  }
}

async function codeOf(sql: string, params: unknown[] = []): Promise<string | undefined> {
  await owner.query('savepoint expect_code');
  try {
    await owner.query(sql, params);
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  } finally {
    await owner.query('rollback to savepoint expect_code');
  }
}

async function give(wordingId: string): Promise<string[]> {
  const rows = await owner.query<{ id: string }>(
    'select app.portal_give_marketing_consent($1) as id',
    [wordingId],
  );
  return rows.rows.map((row) => row.id);
}

type Row = {
  client_id: string;
  given_by_contact_id: string;
  status: string;
  method: string;
  text_document_id: string;
  created_by: string;
  withdrawn: boolean;
};

async function marketingRows(): Promise<Row[]> {
  const rows = await owner.query<Row>(
    'select client_id, given_by_contact_id, status::text as status, method::text as method, ' +
      'text_document_id, created_by, withdrawn_at is not null as withdrawn from consent ' +
      "where purpose = 'marketing' order by client_id, given_at",
  );
  return rows.rows;
}

describe('giving it: an adult, on their own portal, for themselves', () => {
  it('files one row on each record the person is a contact of, each pointing at the wording read', async () => {
    await rolledBack(owner, async () => {
      const ids = await as(PORTAL.motherUser, () => give(W.en));
      expect(ids).toHaveLength(2);
      expect(await marketingRows()).toEqual([
        {
          client_id: PORTAL.childA,
          given_by_contact_id: PORTAL.motherContact,
          status: 'active',
          method: 'portal_switch',
          text_document_id: W.en,
          created_by: PORTAL.motherUser,
          withdrawn: false,
        },
        {
          client_id: PORTAL.childB,
          given_by_contact_id: PORTAL.motherSecondContact,
          status: 'active',
          method: 'portal_switch',
          text_document_id: W.en,
          created_by: PORTAL.motherUser,
          withdrawn: false,
        },
      ]);
    });
  });

  it('accepts the wording in the language the person read, Arabic included', async () => {
    await rolledBack(owner, async () => {
      expect(await as(PORTAL.adultUser, () => give(W.ar))).toHaveLength(1);
      expect((await marketingRows())[0]?.text_document_id).toBe(W.ar);
    });
  });

  it('is audited like every consent, with the switch as the method', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.adultUser, () => give(W.en));
      const trail = await owner.query<{ actor_id: string; reason: string; method: string }>(
        "select actor_id, reason, new_values->>'method' as method from audit_log " +
          "where entity_type = 'consent' and action = 'insert' order by id desc limit 1",
      );
      expect(trail.rows[0]).toEqual({
        actor_id: PORTAL.adultUser,
        reason: 'Turned offers on',
        method: 'portal_switch',
      });
    });
  });

  it("refuses a young person's own login", async () => {
    await rolledBack(owner, async () => {
      const code = await asContact(owner, PORTAL.minorUser, () =>
        codeOf('select app.portal_give_marketing_consent($1)', [W.en]),
      );
      expect(code).toBe(RLS_VIOLATION);
      expect(await marketingRows()).toEqual([]);
    });
  });

  it('refuses a member of the practice, who has no household to give it for', async () => {
    await rolledBack(owner, async () => {
      await setAuditContext(owner, PORTAL.admin);
      const code = await asApiRole(
        owner,
        IDS.tenantA,
        () => codeOf('select app.portal_give_marketing_consent($1)', [W.en]),
        'admin',
      );
      expect(code).toBe(RLS_VIOLATION);
    });
  });

  it('refuses any wording but the current approved marketing one', async () => {
    await rolledBack(owner, async () => {
      for (const wording of [W.retired, W.draft, W.participation, W.otherPractice]) {
        const code = await asContact(owner, PORTAL.motherUser, () =>
          codeOf('select app.portal_give_marketing_consent($1)', [wording]),
        );
        expect(code, wording).toBe(CHECK_VIOLATION);
      }
      expect(await marketingRows()).toEqual([]);
    });
  });

  it('refuses a second giving while the first stands', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.motherUser, () => give(W.en));
      const code = await asContact(owner, PORTAL.motherUser, () =>
        codeOf('select app.portal_give_marketing_consent($1)', [W.en]),
      );
      expect(code).toBe(UNIQUE_VIOLATION);
    });
  });

  it('files nothing on an erased record', async () => {
    await rolledBack(owner, async () => {
      await owner.query("update client set status = 'erased' where id = $1", [PORTAL.childB]);
      await as(PORTAL.motherUser, () => give(W.en));
      expect((await marketingRows()).map((row) => row.client_id)).toEqual([PORTAL.childA]);
    });
  });

  it('leaves the household no write of its own on consent: the switch is the only way in', async () => {
    await rolledBack(owner, async () => {
      const code = await asContact(owner, PORTAL.motherUser, () =>
        codeOf(
          'insert into consent (tenant_id, client_id, given_by_contact_id, purpose, version, ' +
            "text_document_id, method) values ($1, $2, $3, 'marketing', 1, $4, 'portal_switch')",
          [IDS.tenantA, PORTAL.childA, PORTAL.motherContact, W.en],
        ),
      );
      expect(code).toBe(RLS_VIOLATION);
    });
  });
});

describe('withdrawing it: one press, every row, at once', () => {
  it('withdraws every standing row the person gave, on every record', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.motherUser, () => give(W.en));
      const count = await as(PORTAL.motherUser, async () => {
        const rows = await owner.query<{ n: number }>(
          'select app.portal_withdraw_marketing_consent() as n',
        );
        return rows.rows[0]?.n;
      });
      expect(count).toBe(2);
      const rows = await marketingRows();
      expect(rows.map((row) => [row.status, row.withdrawn])).toEqual([
        ['withdrawn', true],
        ['withdrawn', true],
      ]);
    });
  });

  it("never touches another adult's consent on the same record", async () => {
    await rolledBack(owner, async () => {
      // The father has no login; his consent stands for this test on paper.
      await seedConsent(owner, {
        id: '00000001-0000-4000-8000-0000000000a9',
        clientId: PORTAL.childA,
        contactId: PORTAL.fatherContact,
        purpose: 'marketing',
        wordingId: W.en,
      });
      await as(PORTAL.motherUser, () => give(W.en));
      await as(PORTAL.motherUser, () =>
        owner.query('select app.portal_withdraw_marketing_consent()'),
      );
      const father = await owner.query<{ status: string }>(
        'select status::text as status from consent where given_by_contact_id = $1',
        [PORTAL.fatherContact],
      );
      expect(father.rows[0]?.status).toBe('active');
    });
  });

  it('answers nothing withdrawn when nothing stands', async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.adultUser, () =>
        owner.query<{ n: number }>('select app.portal_withdraw_marketing_consent() as n'),
      );
      expect(rows.rows[0]?.n).toBe(0);
    });
  });

  it('may be given again after a withdrawal, as a new row', async () => {
    await rolledBack(owner, async () => {
      await as(PORTAL.adultUser, () => give(W.en));
      await as(PORTAL.adultUser, () =>
        owner.query('select app.portal_withdraw_marketing_consent()'),
      );
      await as(PORTAL.adultUser, () => give(W.ar));
      expect((await marketingRows()).map((row) => row.status)).toEqual(['withdrawn', 'active']);
    });
  });
});

describe('the wording the switch stands beside', () => {
  it('names the current approved marketing wording in the language asked for', async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.adultUser, () =>
        owner.query<{ id: string; version: string }>(
          "select id, version from app.portal_marketing_wording('ar')",
        ),
      );
      expect(rows.rows).toEqual([{ id: W.ar, version: '1.0' }]);
    });
  });

  it("never names another practice's wording", async () => {
    await rolledBack(owner, async () => {
      const rows = await asContact(owner, PORTAL.motherUser, () =>
        owner.query<{ id: string }>("select id from app.portal_marketing_wording('en')"),
      );
      expect(rows.rows.map((row) => row.id)).toEqual([W.en]);
    });
  });
});
