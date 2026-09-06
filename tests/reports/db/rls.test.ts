import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import {
  asApiRole,
  freshDatabase,
  rejectsWith,
  rolledBack,
  seedClient,
  seedContact,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
  setAuditContext,
  AUTH,
  IDS,
  MORE_IDS,
} from '../../db/helpers';

/**
 * The deny cases of `docs/SPEC/reports-v1.md` section 11, proved at the row
 * rather than at a route: the UI hiding a screen is a courtesy, and the
 * database refusing the row is the boundary.
 *
 * Every grant is exercised from the API role with a role stamp, which is how
 * a request actually arrives (`app.actor_roles`), and every refusal names the
 * SQLSTATE it must come back as.
 */

const REPORT = '00000000-0000-4000-8000-0000000006a1';
const REPORT_TWO = '00000000-0000-4000-8000-0000000006a2';
const REPORT_B = '00000000-0000-4000-8000-0000000006b1';
const DRAFT = '00000000-0000-4000-8000-0000000006a3';
const SUPERSEDED = '00000000-0000-4000-8000-0000000006a4';
const CONTACT_B = '00000000-0000-4000-8000-0000000000e2';
const CLIENT_OTHER_PRACTICE = '00000000-0000-4000-8000-0000000000c9';
const PRACTITIONER_B = '00000000-0000-4000-8000-0000000000ba';
const PRACTITIONER_USER_B = '00000000-0000-4000-8000-0000000000b2';

let client: pg.Client;

/** An issued report, written as the table owner so no policy stands in the way. */
async function seedReport(
  id: string,
  tenantId: string,
  clientId: string,
  over: {
    status?: string;
    number?: number;
    supersedesId?: string;
    version?: number;
    signerId?: string;
  } = {},
): Promise<void> {
  const status = over.status ?? 'issued';
  if (status === 'draft') {
    await client.query(
      'insert into report (id, tenant_id, client_id, kind, status, content) ' +
        "values ($1, $2, $3, 'progress', 'draft', '{}'::jsonb)",
      [id, tenantId, clientId],
    );
    return;
  }
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
      'signed_by_practitioner_id, signed_by_name, signed_by_certification, ' +
      'recipient_name, recipient_record_number, practice_legal_name, ' +
      'content, version, supersedes_id, amendment_reason) values ' +
      "($1, $2, $3, 'progress', $4::report_status, $5, current_date, now(), $6, 'Rowan Ridge', " +
      "'bcia_bcn', 'Cedar Meadow', 'MW-000001', 'Synthetic Studio', '{}'::jsonb, $7, $8, $9)",
    [
      id,
      tenantId,
      clientId,
      status,
      over.number ?? 1,
      over.signerId ?? MORE_IDS.practitionerA,
      over.version ?? 1,
      over.supersedesId ?? null,
      over.supersedesId ? 'A correction.' : null,
    ],
  );
}

beforeAll(async () => {
  client = await freshDatabase();
  await setAuditContext(client, IDS.ownerA);
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Practice A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Practice B');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantA, IDS.clientB, IDS.ownerA, 'Ridge');
  await seedClient(client, IDS.tenantB, CLIENT_OTHER_PRACTICE, IDS.ownerB, 'Summit');
  await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  await seedContact(client, IDS.tenantA, IDS.contactA, IDS.clientA, 'synthetic-a');
  await seedContact(client, IDS.tenantA, CONTACT_B, IDS.clientB, 'synthetic-b');
  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await seedUser(client, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedUser(client, {
    id: PRACTITIONER_USER_B,
    tenantId: IDS.tenantB,
    authId: null,
    displayName: 'Practitioner B',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantB, PRACTITIONER_B, PRACTITIONER_USER_B);
  await seedUser(client, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Contact A',
    roles: ['client_contact'],
  });
  // The household's own login, and the legal guardian the read policy now
  // asks for: `seedContact` writes a mother with `is_legal_guardian` false,
  // which is the ordinary default and no longer enough to read a report
  // (docs/SPEC/reports-v1.md section 7.3 as amended 2026-09-06; migration
  // 955). `CONTACT_B` is deliberately left as it is, so the deny case below
  // has somebody to be about.
  await client.query('update contact set user_id = $1, is_legal_guardian = true where id = $2', [
    MORE_IDS.contactUserA,
    IDS.contactA,
  ]);

  await seedReport(REPORT, IDS.tenantA, IDS.clientA, { number: 1 });
  await seedReport(DRAFT, IDS.tenantA, IDS.clientA, { status: 'draft' });
  await seedReport(SUPERSEDED, IDS.tenantA, IDS.clientA, { status: 'superseded', number: 2 });
  await seedReport(REPORT_TWO, IDS.tenantA, IDS.clientB, { number: 3 });
  await seedReport(REPORT_B, IDS.tenantB, CLIENT_OTHER_PRACTICE, {
    number: 1,
    signerId: PRACTITIONER_B,
  });
}, 180_000);

afterAll(async () => {
  await client.end();
});

/** Counts the reports one role can see in one practice. */
async function visibleTo(roles: string, tenantId: string = IDS.tenantA): Promise<number> {
  return rolledBack(client, async () =>
    asApiRole(
      client,
      tenantId,
      async () => {
        const { rows } = await client.query<{ n: string }>(
          'select count(*)::text as n from report',
        );
        return Number(rows[0]?.n ?? 0);
      },
      roles,
    ),
  );
}

describe('who may read a report', () => {
  it('shows the owner, an admin and the lead practitioner every one of the practice’s', async () => {
    for (const role of ['owner', 'admin', 'lead_practitioner']) {
      expect(await visibleTo(role), role).toBe(4);
    }
  });

  it('shows finance none of them, because a report is not money', async () => {
    expect(await visibleTo('finance')).toBe(0);
  });

  it('shows a practitioner nothing for a client who is not on their schedule', async () => {
    // app.client_visible_to_practitioner: ninety days back, thirty forward,
    // confirmed visits only. This practitioner has no appointments at all.
    expect(await visibleTo('practitioner')).toBe(0);
  });

  it('shows a household only its own client’s issued reports', async () => {
    const seen = await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.contactUserA,
          ]);
          const { rows } = await client.query<{ id: string; status: string }>(
            'select id, status from report order by id',
          );
          return rows;
        },
        'client_contact',
      ),
    );
    // The issued one, and neither the draft nor the superseded version they
    // were never sent (section 7.3).
    expect(seen.map((row) => row.id)).toEqual([REPORT]);
  });

  it('shows a household a superseded version once one was actually sent to it', async () => {
    const seen = await rolledBack(client, async () => {
      await client.query(
        'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
          "values ($1, $2, $3, $4, 'whatsapp')",
        [IDS.tenantA, SUPERSEDED, IDS.clientA, IDS.contactA],
      );
      return asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.contactUserA,
          ]);
          const { rows } = await client.query<{ id: string }>('select id from report order by id');
          return rows.map((row) => row.id);
        },
        'client_contact',
      );
    });
    expect(seen).toContain(SUPERSEDED);
    expect(seen).not.toContain(DRAFT);
  });

  it('shows a contact who is not a legal guardian nothing', async () => {
    // The operator's decision of 2026-09-06: a report about a young person is
    // read by a legal guardian, or by the person themselves once they are an
    // adult, and by nobody else on the record. `CONTACT_B` is a contact of
    // clientB with a login and no guardianship, so clientB's own issued
    // report is refused them.
    const seen = await rolledBack(client, async () => {
      await client.query('update contact set user_id = $1 where id = $2', [
        MORE_IDS.contactUserA,
        CONTACT_B,
      ]);
      return asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.contactUserA,
          ]);
          const { rows } = await client.query<{ id: string }>('select id from report');
          return rows.map((row) => row.id);
        },
        'client_contact',
      );
    });
    expect(seen).not.toContain(REPORT_TWO);
  });

  it('shows another practice nothing at all', async () => {
    // Practice B has one report of its own and cannot see A's four.
    expect(await visibleTo('owner', IDS.tenantB)).toBe(1);
  });
});

describe('what may be written', () => {
  it('lets the owner update a draft', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        const { rowCount } = await client.query(
          'update report set content = \'{"kind":"progress"}\'::jsonb where id = $1',
          [DRAFT],
        );
        expect(rowCount).toBe(1);
      }),
    );
  });

  it('refuses the same update on an issued row — the same grant, a different row', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(
          client,
          '23001',
          'update report set content = \'{"kind":"progress"}\'::jsonb where id = $1',
          [REPORT],
        );
      }),
    );
  });

  it('refuses a delete of a report to the API role, draft or issued', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        // No delete grant at all: refused at 42501 before a policy is asked.
        await rejectsWith(client, '42501', 'delete from report where id = $1', [DRAFT]);
        await rejectsWith(client, '42501', 'delete from report where id = $1', [REPORT]);
      }),
    );
  });

  it('refuses an admin and finance a draft of their own', async () => {
    for (const role of ['admin', 'finance']) {
      await rolledBack(client, async () =>
        asApiRole(
          client,
          IDS.tenantA,
          async () => {
            await rejectsWith(
              client,
              '42501',
              'insert into report (tenant_id, client_id, kind, content) ' +
                "values ($1, $2, 'progress', '{}'::jsonb)",
              [IDS.tenantA, IDS.clientA],
            );
          },
          role,
        ),
      );
    }
  });

  it('refuses a household writing a report about itself', async () => {
    await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.contactUserA,
          ]);
          await rejectsWith(
            client,
            '42501',
            'insert into report (tenant_id, client_id, kind, content) ' +
              "values ($1, $2, 'progress', '{}'::jsonb)",
            [IDS.tenantA, IDS.clientA],
          );
        },
        'client_contact',
      ),
    );
  });

  it('refuses a report written against another practice’s client', async () => {
    // Refused by the composite key rather than by a policy, and that is the
    // stronger answer: `(tenant_id, client_id)` references `client
    // (tenant_id, id)` (migration 099), so a reference across practices is a
    // foreign-key violation at write time and never an invisible row later.
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(
          client,
          '23503',
          'insert into report (tenant_id, client_id, kind, content) ' +
            "values ($1, $2, 'progress', '{}'::jsonb)",
          [IDS.tenantA, CLIENT_OTHER_PRACTICE],
        );
      }),
    );
  });
});

describe('the chain', () => {
  it('lets only the owner and the lead practitioner mark a version superseded', async () => {
    // The guard's branch (b) (migration 600). Superseding hides a version the
    // household may already hold, which section 7.1 gives to those two alone;
    // asked at the row, because the route asking is a courtesy and this is the
    // boundary. Run as the table owner with a role stamped, so it is the
    // guard's answer being read and not a policy's.
    await rolledBack(client, async () => {
      for (const role of ['practitioner', 'admin', 'finance', 'client_contact']) {
        await client.query("select set_config('app.actor_roles', $1, true)", [role]);
        await rejectsWith(
          client,
          '42501',
          "update report set status = 'superseded' where id = $1",
          [REPORT],
        );
      }
      for (const role of ['owner', 'lead_practitioner']) {
        await client.query("select set_config('app.actor_roles', $1, true)", [role]);
        await client.query('savepoint allowed');
        const done = await client.query("update report set status = 'superseded' where id = $1", [
          REPORT,
        ]);
        expect(done.rowCount, role).toBe(1);
        await client.query('rollback to savepoint allowed');
      }
    });
  });

  it('refuses a second successor to one version, so a chain cannot fork', async () => {
    await rolledBack(client, async () => {
      // One successor is ordinary; a second would give two answers to "which
      // version is current" (section 10, decision 5).
      await client.query(
        'insert into report (id, tenant_id, client_id, kind, content, version, supersedes_id, ' +
          "amendment_reason) values ($1, $2, $3, 'progress', '{}'::jsonb, 2, $4, $5)",
        [
          '00000000-0000-4000-8000-0000000006a5',
          IDS.tenantA,
          IDS.clientA,
          REPORT,
          'The first correction.',
        ],
      );
      await rejectsWith(
        client,
        '23505',
        'insert into report (id, tenant_id, client_id, kind, content, version, supersedes_id, ' +
          "amendment_reason) values ($1, $2, $3, 'progress', '{}'::jsonb, 2, $4, $5)",
        [
          '00000000-0000-4000-8000-0000000006a6',
          IDS.tenantA,
          IDS.clientA,
          REPORT,
          'A second correction of the same version.',
        ],
      );
    });
  });

  it('refuses a version above one with no reason for it', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, version, supersedes_id) ' +
          "values ($1, $2, 'progress', '{}'::jsonb, 2, $3)",
        [IDS.tenantA, IDS.clientA, REPORT],
      );
    });
  });

  it('refuses an issued row with no signature on it', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content) ' +
          "values ($1, $2, 'progress', 'issued', '{}'::jsonb)",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });

  it('refuses a draft that carries a number or a signature', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content, number) ' +
          "values ($1, $2, 'progress', 'draft', '{}'::jsonb, 99)",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });

  it('refuses two reports sharing a reference in one practice', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23505',
        'insert into report (tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
          'signed_by_practitioner_id, signed_by_name, signed_by_certification, ' +
          'recipient_name, recipient_record_number, practice_legal_name, content) values ' +
          "($1, $2, 'progress', 'issued', 1, " +
          "current_date, now(), $3, 'Rowan Ridge', 'bcia_bcn', 'Cedar Meadow', 'MW-000001', " +
          "'Synthetic Studio', '{}'::jsonb)",
        [IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA],
      );
    });
  });

  it('lets two practices each hold their own RPT-000001', async () => {
    // The counter and the unique key are both per practice, so a reference is
    // the practice's own and never a number in a global sequence.
    const { rows } = await client.query<{ n: string }>(
      "select count(*)::text as n from report where reference = 'RPT-000001'",
    );
    expect(Number(rows[0]?.n ?? 0)).toBe(2);
  });
});

describe('deliveries', () => {
  it('refuses a delivery to a contact of another client, by the composite key', async () => {
    // CONTACT_B belongs to clientB; REPORT is clientA's. The key is what
    // refuses it, not a query that happens to filter.
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23503',
        'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
          "values ($1, $2, $3, $4, 'whatsapp')",
        [IDS.tenantA, REPORT, IDS.clientA, CONTACT_B],
      );
    });
  });

  it('refuses a delivery naming a client that is not the report’s own', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23503',
        'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
          "values ($1, $2, $3, $4, 'email')",
        [IDS.tenantA, REPORT, IDS.clientB, CONTACT_B],
      );
    });
  });

  it('lets the owner, an admin and the lead practitioner write one, and nobody else', async () => {
    for (const role of ['owner', 'admin', 'lead_practitioner']) {
      await rolledBack(client, async () =>
        asApiRole(
          client,
          IDS.tenantA,
          async () => {
            const { rowCount } = await client.query(
              'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
                "values (app.current_tenant_id(), $1, $2, $3, 'email')",
              [REPORT, IDS.clientA, IDS.contactA],
            );
            expect(rowCount, role).toBe(1);
          },
          role,
        ),
      );
    }
    for (const role of ['practitioner', 'finance', 'client_contact']) {
      await rolledBack(client, async () =>
        asApiRole(
          client,
          IDS.tenantA,
          async () => {
            await rejectsWith(
              client,
              '42501',
              'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
                "values (app.current_tenant_id(), $1, $2, $3, 'email')",
              [REPORT, IDS.clientA, IDS.contactA],
            );
          },
          role,
        ),
      );
    }
  });

  it('refuses to change or remove a delivery: it happened or it did not', async () => {
    await rolledBack(client, async () => {
      await client.query(
        'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
          "values ($1, $2, $3, $4, 'email')",
        [IDS.tenantA, REPORT, IDS.clientA, IDS.contactA],
      );
      await asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, '42501', 'update report_delivery set channel = $1', ['whatsapp']);
        await rejectsWith(client, '42501', 'delete from report_delivery');
      });
    });
  });

  it('shows a household nothing of the delivery record', async () => {
    const seen = await rolledBack(client, async () => {
      await client.query(
        'insert into report_delivery (tenant_id, report_id, client_id, contact_id, channel) ' +
          "values ($1, $2, $3, $4, 'email')",
        [IDS.tenantA, REPORT, IDS.clientA, IDS.contactA],
      );
      return asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.contactUserA,
          ]);
          const { rows } = await client.query<{ n: string }>(
            'select count(*)::text as n from report_delivery',
          );
          return Number(rows[0]?.n ?? 0);
        },
        'client_contact',
      );
    });
    expect(seen).toBe(0);
  });
});

describe('the reference counter', () => {
  it('is not readable by anybody at all', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, '42501', 'select next_number from report_number_series');
      }),
    );
  });

  it('gives two concurrent issues two different numbers', async () => {
    const numbers = await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        const first = await client.query<{ n: number }>('select app.next_report_number() as n');
        const second = await client.query<{ n: number }>('select app.next_report_number() as n');
        return [first.rows[0]?.n, second.rows[0]?.n];
      }),
    );
    expect(numbers[0]).not.toBe(numbers[1]);
  });
});
