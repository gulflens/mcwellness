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
 * The brain-map report's kind and the past record's status, proved at the row
 * (docs/SPEC/reports-qeeg.md sections 11 and 13; migrations 602 and 603).
 *
 * A past record brought in from the old tool is **kept, not signed**: it has
 * no reference, no signer's snapshot and no PDF, it names the file it came
 * from, it is never shown to the household, and once kept the only change it
 * admits is the one withdraw an owner or a lead practitioner makes when it was
 * kept against the wrong client. Each of those is asked of the database here,
 * because a route refusing is a courtesy and the row refusing is the
 * boundary.
 */

const DRAFT = '00000000-0000-4000-8000-0000000006c1';
const IMPORT_DRAFT = '00000000-0000-4000-8000-0000000006c2';
const KEPT = '00000000-0000-4000-8000-0000000006c3';
const PROGRESS_DRAFT = '00000000-0000-4000-8000-0000000006c4';
const OTHER_CLIENT_QEEG = '00000000-0000-4000-8000-0000000006c5';
const LEAD_USER = '00000000-0000-4000-8000-0000000000a4';
const ISSUED_QEEG = '00000000-0000-4000-8000-0000000006c6';
const ISSUED_PROGRESS = '00000000-0000-4000-8000-0000000006c7';
const APPOINTMENT = '00000000-0000-4000-8000-0000000006c8';

const SHA = 'a'.repeat(64);
const OTHER_SHA = 'b'.repeat(64);
const FORMAT = 'qeeg.json/1';

let client: pg.Client;

/** A past record, drafted and then kept, written as the table owner. */
async function seedKept(id: string, sha: string): Promise<void> {
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      'values ($1, $2, $3, \'qeeg\', \'{"note":"brought in"}\'::jsonb, $4, $5)',
    [id, IDS.tenantA, IDS.clientA, FORMAT, sha],
  );
  await client.query("update report set status = 'imported' where id = $1", [id]);
}

/** A signed report of client A, written as the table owner. */
async function seedIssued(id: string, kind: string, number: number): Promise<void> {
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, status, number, issued_on, signed_at, ' +
      'signed_by_practitioner_id, signed_by_name, signed_by_certification, ' +
      'recipient_name, recipient_record_number, practice_legal_name, content) values ' +
      "($1, $2, $3, $4::report_kind, 'issued', $5, current_date, now(), $6, 'Rowan Ridge', " +
      "'bcia_bcn', 'Cedar Meadow', 'MW-000001', 'Synthetic Studio', '{}'::jsonb)",
    [id, IDS.tenantA, IDS.clientA, kind, number, MORE_IDS.practitionerA],
  );
}

beforeAll(async () => {
  client = await freshDatabase();
  await setAuditContext(client, IDS.ownerA);
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Practice A');
  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantA, IDS.clientB, IDS.ownerA, 'Ridge');
  await seedContact(client, IDS.tenantA, IDS.contactA, IDS.clientA, 'synthetic-a');
  await seedUser(client, {
    id: MORE_IDS.contactUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.contactA,
    displayName: 'Contact A',
    roles: ['client_contact'],
  });
  await seedUser(client, {
    id: LEAD_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Lead A',
    roles: ['lead_practitioner'],
  });
  await seedUser(client, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: AUTH.practitionerA,
    displayName: 'Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  // A legal guardian with a login: the one household reader the policy admits.
  await client.query('update contact set user_id = $1, is_legal_guardian = true where id = $2', [
    MORE_IDS.contactUserA,
    IDS.contactA,
  ]);

  await client.query(
    'insert into report (id, tenant_id, client_id, kind, content) ' +
      "values ($1, $2, $3, 'qeeg', '{}'::jsonb)",
    [DRAFT, IDS.tenantA, IDS.clientA],
  );
  // Read from a file, so it says something: an import with nothing in it is
  // never kept (migration 972).
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
      'values ($1, $2, $3, \'qeeg\', \'{"edition":"initial"}\'::jsonb, $4, $5)',
    [IMPORT_DRAFT, IDS.tenantA, IDS.clientA, FORMAT, OTHER_SHA],
  );
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, content) ' +
      "values ($1, $2, $3, 'progress', '{}'::jsonb)",
    [PROGRESS_DRAFT, IDS.tenantA, IDS.clientA],
  );
  await client.query(
    'insert into report (id, tenant_id, client_id, kind, content) ' +
      "values ($1, $2, $3, 'qeeg', '{}'::jsonb)",
    [OTHER_CLIENT_QEEG, IDS.tenantA, IDS.clientB],
  );
  await seedKept(KEPT, SHA);
  await seedIssued(ISSUED_QEEG, 'qeeg', 1);
  await seedIssued(ISSUED_PROGRESS, 'progress', 2);

  // Practitioner A with a visit for client A, so the row policy admits them
  // to client A's reports (app.client_visible_to_practitioner, 201).
  await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);
  await seedServiceType(client, IDS.tenantA, MORE_IDS.serviceTypeA, 'nf-session');
  await client.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ' +
      "($1, $2, $3, $4, $5, $6, 'home', now() - interval '2 days', " +
      "now() - interval '2 days' + interval '45 minutes', 'completed')",
    [
      APPOINTMENT,
      IDS.tenantA,
      IDS.clientA,
      MORE_IDS.practitionerA,
      MORE_IDS.serviceTypeA,
      IDS.locationA,
    ],
  );
}, 180_000);

afterAll(async () => {
  await client.end();
});

describe('the new kind and the new status', () => {
  it('knows qeeg as a kind of report and imported as a status', async () => {
    const { rows } = await client.query<{ kinds: string; statuses: string }>(
      'select enum_range(null::report_kind)::text as kinds, ' +
        'enum_range(null::report_status)::text as statuses',
    );
    expect(rows[0]?.kinds).toBe('{session,progress,qeeg}');
    expect(rows[0]?.statuses).toBe('{draft,issued,superseded,imported}');
  });

  it('lets the API role save a brain-map draft as it saves the other kinds', async () => {
    for (const role of ['owner', 'lead_practitioner']) {
      await rolledBack(client, async () =>
        asApiRole(
          client,
          IDS.tenantA,
          async () => {
            const { rowCount } = await client.query(
              'insert into report (tenant_id, client_id, kind, content) ' +
                "values (app.current_tenant_id(), $1, 'qeeg', '{}'::jsonb)",
              [IDS.clientA],
            );
            expect(rowCount, role).toBe(1);
          },
          role,
        ),
      );
    }
  });

  it('lets a brain-map draft name its twin and what it is compared with', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        const { rowCount } = await client.query(
          'insert into report (tenant_id, client_id, kind, locale, content, twin_of_id, ' +
            "compared_with_id) values (app.current_tenant_id(), $1, 'qeeg', 'ar', '{}'::jsonb, " +
            '$2, $3)',
          [IDS.clientA, DRAFT, KEPT],
        );
        expect(rowCount).toBe(1);
      }),
    );
  });
});

describe('a twin is the same brain map in the other language', () => {
  it('refuses a twin that is not a brain map', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23503',
        'insert into report (tenant_id, client_id, kind, locale, content, twin_of_id) ' +
          "values ($1, $2, 'qeeg', 'ar', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, PROGRESS_DRAFT],
      );
    });
  });

  it('refuses a twin in the same language', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23503',
        'insert into report (tenant_id, client_id, kind, locale, content, twin_of_id) ' +
          "values ($1, $2, 'qeeg', 'en', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, DRAFT],
      );
    });
  });

  it('refuses moving a report into its twin’s language once it has one', async () => {
    await rolledBack(client, async () => {
      await client.query(
        'insert into report (tenant_id, client_id, kind, locale, content, twin_of_id) ' +
          "values ($1, $2, 'qeeg', 'ar', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, DRAFT],
      );
      await rejectsWith(client, '23503', "update report set locale = 'ar' where id = $1", [DRAFT]);
    });
  });
});

describe('a comparison is with a signed brain map or a kept past record', () => {
  const COMPARE =
    'insert into report (tenant_id, client_id, kind, content, compared_with_id) ' +
    "values ($1, $2, 'qeeg', '{}'::jsonb, $3)";

  it('admits a signed brain-map report and a kept past record', async () => {
    await rolledBack(client, async () => {
      for (const target of [ISSUED_QEEG, KEPT]) {
        const { rowCount } = await client.query(COMPARE, [IDS.tenantA, IDS.clientA, target]);
        expect(rowCount, target).toBe(1);
      }
    });
  });

  it('admits one that has since been replaced, which is still signed', async () => {
    await rolledBack(client, async () => {
      await client.query("update report set status = 'superseded' where id = $1", [ISSUED_QEEG]);
      const { rowCount } = await client.query(COMPARE, [IDS.tenantA, IDS.clientA, ISSUED_QEEG]);
      expect(rowCount).toBe(1);
    });
  });

  it('refuses an unsigned draft, and a past record not yet kept', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, '23503', COMPARE, [IDS.tenantA, IDS.clientA, DRAFT]);
      await rejectsWith(client, '23503', COMPARE, [IDS.tenantA, IDS.clientA, IMPORT_DRAFT]);
    });
  });

  it('refuses a signed report that is not a brain map', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, '23503', COMPARE, [IDS.tenantA, IDS.clientA, ISSUED_PROGRESS]);
    });
  });

  it('refuses a past record that has been withdrawn', async () => {
    await rolledBack(client, async () => {
      await client.query(
        "update report set content = '{}'::jsonb, withdrawn_at = now(), " +
          "withdraw_reason = 'Kept against the wrong client.' where id = $1",
        [KEPT],
      );
      await rejectsWith(client, '23503', COMPARE, [IDS.tenantA, IDS.clientA, KEPT]);
    });
  });

  it('refuses withdrawing a past record while a report is compared with it', async () => {
    // The follow-up is re-pointed first, or it would be left comparing with
    // something that no longer says anything.
    await rolledBack(client, async () => {
      await client.query(COMPARE, [IDS.tenantA, IDS.clientA, KEPT]);
      await rejectsWith(
        client,
        '23503',
        "update report set content = '{}'::jsonb, withdrawn_at = now(), " +
          "withdraw_reason = 'Kept against the wrong client.' where id = $1",
        [KEPT],
      );
    });
  });
});

describe('bringing a file in is the owner’s and the lead practitioner’s', () => {
  const IMPORT =
    'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
    "values (app.current_tenant_id(), $1, 'qeeg', '{}'::jsonb, $2, $3)";

  async function asPractitioner(fn: () => Promise<void>): Promise<void> {
    await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [
            MORE_IDS.practitionerUserA,
          ]);
          await fn();
        },
        'practitioner',
      ),
    );
  }

  it('lets a practitioner on the client’s schedule draft a brain map', async () => {
    await asPractitioner(async () => {
      const { rowCount } = await client.query(
        'insert into report (tenant_id, client_id, kind, content) ' +
          "values (app.current_tenant_id(), $1, 'qeeg', '{}'::jsonb)",
        [IDS.clientA],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('refuses the same practitioner a draft brought in from a file', async () => {
    await asPractitioner(async () => {
      await rejectsWith(client, '42501', IMPORT, [IDS.clientA, FORMAT, 'f'.repeat(64)]);
    });
  });

  it('refuses the same practitioner writing a source onto a draft, or editing an import', async () => {
    await asPractitioner(async () => {
      await rejectsWith(
        client,
        '42501',
        'update report set imported_from = $2, source_sha256 = $3 where id = $1',
        [DRAFT, FORMAT, 'f'.repeat(64)],
      );
      await rejectsWith(
        client,
        '42501',
        'update report set content = \'{"note":"edited"}\'::jsonb where id = $1',
        [IMPORT_DRAFT],
      );
    });
  });

  it('lets the lead practitioner bring one in', async () => {
    await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          const { rowCount } = await client.query(IMPORT, [IDS.clientA, FORMAT, 'f'.repeat(64)]);
          expect(rowCount).toBe(1);
        },
        'lead_practitioner',
      ),
    );
  });
});

describe('where the new columns may be used', () => {
  it('refuses a twin or a comparison on a report that is not a brain map', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, twin_of_id) ' +
          "values ($1, $2, 'progress', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, PROGRESS_DRAFT],
      );
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, compared_with_id) ' +
          "values ($1, $2, 'session', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, KEPT],
      );
    });
  });

  it('refuses a twin or a comparison that is another client’s report', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23503',
        'insert into report (tenant_id, client_id, kind, content, twin_of_id) ' +
          "values ($1, $2, 'qeeg', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, OTHER_CLIENT_QEEG],
      );
      await rejectsWith(
        client,
        '23503',
        'insert into report (tenant_id, client_id, kind, content, compared_with_id) ' +
          "values ($1, $2, 'qeeg', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, OTHER_CLIENT_QEEG],
      );
    });
  });

  it('refuses a report that is its own twin', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, '23514', 'update report set twin_of_id = id where id = $1', [
        DRAFT,
      ]);
    });
  });

  it('refuses a source on a report that is not a brain map', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
          "values ($1, $2, 'progress', '{}'::jsonb, $3, $4)",
        [IDS.tenantA, IDS.clientA, FORMAT, 'c'.repeat(64)],
      );
    });
  });

  it('refuses a fingerprint without its format, or a fingerprint that is not one', async () => {
    // The other half — a format whose fingerprint has gone — is what an
    // erasure leaves (migration 972, restating 602's report_source_together),
    // and a past record may be without it only once it says nothing
    // (tests/reports/db/qeeg_erasure.test.ts).
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, source_sha256) ' +
          "values ($1, $2, 'qeeg', '{}'::jsonb, $3)",
        [IDS.tenantA, IDS.clientA, 'c'.repeat(64)],
      );
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
          "values ($1, $2, 'qeeg', '{}'::jsonb, $3, 'not a fingerprint')",
        [IDS.tenantA, IDS.clientA, FORMAT],
      );
    });
  });

  it('refuses a source that reads as a file name rather than a format', async () => {
    await rolledBack(client, async () => {
      for (const name of ['Report for Cedar.json', 'qeeg.json', 'QEEG.JSON/1', '/1']) {
        await rejectsWith(
          client,
          '23514',
          'insert into report (tenant_id, client_id, kind, content, imported_from, ' +
            "source_sha256) values ($1, $2, 'qeeg', '{}'::jsonb, $3, $4)",
          [IDS.tenantA, IDS.clientA, name, 'c'.repeat(64)],
        );
      }
    });
  });

  it('refuses the same file brought in twice for one client', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23505',
        'insert into report (tenant_id, client_id, kind, content, imported_from, source_sha256) ' +
          "values ($1, $2, 'qeeg', '{}'::jsonb, $3, $4)",
        [IDS.tenantA, IDS.clientA, FORMAT, SHA],
      );
    });
  });
});

describe('a past record is kept, not signed', () => {
  it('refuses imported on a report that is not a brain map', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content) ' +
          "values ($1, $2, 'progress', 'imported', '{}'::jsonb)",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });

  it('refuses a past record with no source', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content) ' +
          "values ($1, $2, 'qeeg', 'imported', '{}'::jsonb)",
        [IDS.tenantA, IDS.clientA],
      );
    });
  });

  it('refuses a past record that carries a reference', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content, imported_from, ' +
          "source_sha256, number) values ($1, $2, 'qeeg', 'imported', '{}'::jsonb, $3, $4, 7)",
        [IDS.tenantA, IDS.clientA, FORMAT, 'd'.repeat(64)],
      );
    });
  });

  it('refuses a past record that carries a signature', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content, imported_from, ' +
          'source_sha256, signed_at, signed_by_name) ' +
          "values ($1, $2, 'qeeg', 'imported', '{}'::jsonb, $3, $4, now(), 'Rowan Ridge')",
        [IDS.tenantA, IDS.clientA, FORMAT, 'd'.repeat(64)],
      );
    });
  });

  it('refuses a past record that carries a PDF', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        'insert into report (tenant_id, client_id, kind, status, content, imported_from, ' +
          "source_sha256, document_id) values ($1, $2, 'qeeg', 'imported', '{}'::jsonb, $3, $4, $5)",
        [IDS.tenantA, IDS.clientA, FORMAT, 'd'.repeat(64), '00000000-0000-4000-8000-0000000006cf'],
      );
    });
  });

  it('refuses to sign a report brought in from a file', async () => {
    // Its fixed wording would be today's and not what the household received
    // (section 11, point 4). The signature below is otherwise complete.
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        "update report set status = 'issued', number = 50, issued_on = current_date, " +
          "signed_at = now(), signed_by_practitioner_id = $2, signed_by_name = 'Rowan Ridge', " +
          "signed_by_certification = 'bcia_bcn', recipient_name = 'Cedar Meadow', " +
          "recipient_record_number = 'MW-000001', practice_legal_name = 'Synthetic Studio' " +
          'where id = $1',
        [IMPORT_DRAFT, MORE_IDS.practitionerA],
      );
    });
  });

  it('refuses the API role writing a past record in one step', async () => {
    // A past record is a reviewed draft that was kept (app.keep_imported_report),
    // never a row that arrives already frozen.
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(
          client,
          '42501',
          'insert into report (tenant_id, client_id, kind, status, content, imported_from, ' +
            "source_sha256) values (app.current_tenant_id(), $1, 'qeeg', 'imported', " +
            "'{}'::jsonb, $2, $3)",
          [IDS.clientA, FORMAT, 'e'.repeat(64)],
        );
      }),
    );
  });
});

describe('keeping a past record', () => {
  it('lets the owner and the lead practitioner keep a reviewed import', async () => {
    for (const [role, actor] of [
      ['owner', IDS.ownerA],
      ['lead_practitioner', LEAD_USER],
    ] as const) {
      const status = await rolledBack(client, async () =>
        asApiRole(
          client,
          IDS.tenantA,
          async () => {
            await client.query("select set_config('app.actor_id', $1, true)", [actor]);
            const { rows } = await client.query<{ status: string }>(
              'select status::text from app.keep_imported_report($1)',
              [IMPORT_DRAFT],
            );
            return rows[0]?.status;
          },
          role,
        ),
      );
      expect(status, role).toBe('imported');
    }
  });

  it('refuses a practitioner keeping one', async () => {
    await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await rejectsWith(client, '42501', 'select app.keep_imported_report($1)', [IMPORT_DRAFT]);
        },
        'practitioner',
      ),
    );
    // Nor by writing the status directly, which the guard asks as well.
    await rolledBack(client, async () => {
      await client.query("select set_config('app.actor_roles', 'practitioner', true)");
      await rejectsWith(client, '42501', "update report set status = 'imported' where id = $1", [
        IMPORT_DRAFT,
      ]);
    });
  });

  it('refuses to keep a draft that was never brought in from a file', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, '23514', 'select app.keep_imported_report($1)', [DRAFT]);
        await rejectsWith(client, '23514', 'select app.keep_imported_report($1)', [PROGRESS_DRAFT]);
      }),
    );
  });

  it('refuses to keep one that is already kept', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        await rejectsWith(client, '23001', 'select app.keep_imported_report($1)', [KEPT]);
      }),
    );
  });
});

describe('a kept past record is frozen but for one withdraw', () => {
  const WITHDRAW =
    "update report set content = '{}'::jsonb, withdrawn_at = now(), " +
    "withdraw_reason = 'Kept against the wrong client.' where id = $1";

  it('admits the withdraw once, by the lead practitioner, and nothing after it', async () => {
    await rolledBack(client, async () =>
      asApiRole(
        client,
        IDS.tenantA,
        async () => {
          await client.query("select set_config('app.actor_id', $1, true)", [LEAD_USER]);
          const { rowCount } = await client.query(WITHDRAW, [KEPT]);
          expect(rowCount).toBe(1);
          const { rows } = await client.query<{ source: string | null; content: unknown }>(
            'select source_sha256 as source, content from report where id = $1',
            [KEPT],
          );
          // Content cleared, the stamp kept (section 11, point 7).
          expect(rows[0]).toEqual({ source: SHA, content: {} });
          await rejectsWith(client, '23001', WITHDRAW, [KEPT]);
          await rejectsWith(
            client,
            '23001',
            "update report set withdraw_reason = 'A second reason.' where id = $1",
            [KEPT],
          );
        },
        'lead_practitioner',
      ),
    );
  });

  it('lets the owner withdraw one', async () => {
    await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        const { rowCount } = await client.query(WITHDRAW, [KEPT]);
        expect(rowCount).toBe(1);
      }),
    );
  });

  it('refuses the withdraw to anybody else', async () => {
    await rolledBack(client, async () => {
      for (const role of ['practitioner', 'admin', 'finance', 'client_contact']) {
        await client.query("select set_config('app.actor_roles', $1, true)", [role]);
        await rejectsWith(client, '42501', WITHDRAW, [KEPT]);
      }
    });
  });

  it('refuses a withdraw that keeps the content, or gives no reason', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23001',
        "update report set withdrawn_at = now(), withdraw_reason = 'Wrong client.' where id = $1",
        [KEPT],
      );
      await rejectsWith(
        client,
        '23514',
        "update report set content = '{}'::jsonb, withdrawn_at = now() where id = $1",
        [KEPT],
      );
    });
  });

  it('refuses every other change to a kept past record', async () => {
    await rolledBack(client, async () => {
      for (const sql of [
        'update report set content = \'{"note":"edited"}\'::jsonb where id = $1',
        "update report set status = 'superseded' where id = $1",
        "update report set status = 'draft' where id = $1",
        "update report set locale = 'ar' where id = $1",
        'update report set compared_with_id = null, twin_of_id = $2 where id = $1',
      ]) {
        await rejectsWith(client, '23001', sql, sql.includes('$2') ? [KEPT, DRAFT] : [KEPT]);
      }
    });
  });

  it('refuses a withdraw reason longer than the house’s two hundred characters', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        "update report set content = '{}'::jsonb, withdrawn_at = now(), withdraw_reason = $2 " +
          'where id = $1',
        [KEPT, 'x'.repeat(201)],
      );
      const { rowCount } = await client.query(
        "update report set content = '{}'::jsonb, withdrawn_at = now(), withdraw_reason = $2 " +
          'where id = $1',
        [KEPT, 'x'.repeat(200)],
      );
      expect(rowCount).toBe(1);
    });
  });

  it('refuses a withdraw stamp on anything but a past record', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(
        client,
        '23514',
        "update report set withdrawn_at = now(), withdraw_reason = 'Wrong client.' where id = $1",
        [DRAFT],
      );
    });
  });

  it('refuses the delete of a past record', async () => {
    await rolledBack(client, async () => {
      await rejectsWith(client, '23001', 'delete from report where id = $1', [KEPT]);
    });
  });
});

describe('the household', () => {
  it('never sees a past record, even one about its own client', async () => {
    const seen = await rolledBack(client, async () =>
      asApiRole(
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
      ),
    );
    expect(seen).not.toContain(KEPT);
  });

  it('while the practice sees it', async () => {
    const seen = await rolledBack(client, async () =>
      asApiRole(client, IDS.tenantA, async () => {
        const { rows } = await client.query<{ id: string }>('select id from report');
        return rows.map((row) => row.id);
      }),
    );
    expect(seen).toContain(KEPT);
  });
});
