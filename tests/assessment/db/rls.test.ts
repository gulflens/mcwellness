import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  IDS,
  MORE_IDS,
  asApiRole,
  freshDatabase,
  rejectsWith,
  seedClient,
  seedLocation,
  seedPractitioner,
  seedServiceType,
  seedTenant,
  seedUser,
} from '../../db/helpers';
import {
  assessmentId,
  seedAppointment,
  seedAssessment,
  seedClientDocument,
  seedConsent,
  seedConsentDocument,
  seedContact,
} from './helpers';

/**
 * Who the database lets near a measurement (docs/SPEC/assessment.md sections
 * 4, 7 and 11). One test per grant, and the deny cases the spec names.
 *
 * **The household seeing nothing is the headline.** A qEEG export means
 * nothing without the practitioner's reading of it, and a family left alone
 * with band figures will make of them exactly what the consent promises the
 * practice will not. That is a rule in the database rather than a screen with
 * no link on it, and this is where it is proved.
 *
 * Everything is synthetic and inside the reserved ranges
 * (.claude/rules/testing.md).
 */

const RLS_VIOLATION = '42501';
const FK_VIOLATION = '23503';
const RESTRICT_VIOLATION = '23001';

const SERVICE = MORE_IDS.serviceTypeA;
const OTHER_PRACTITIONER_USER = assessmentId('a1', 1);
const OTHER_PRACTITIONER = assessmentId('a1', 2);
const CONTACT_USER = assessmentId('a2', 1);
const CONTACT = assessmentId('a2', 2);
const FINANCE_USER = assessmentId('a3', 1);
const ADMIN_USER = assessmentId('a4', 1);
const APPOINTMENT = assessmentId('a5', 1);
const ON_SCHEDULE = assessmentId('b1', 1);
const OFF_SCHEDULE_CLIENT = assessmentId('b2', 1);
const OFF_SCHEDULE = assessmentId('b2', 2);
const FOREIGN = assessmentId('b3', 1);
const DOCUMENT_A = assessmentId('c1', 1);
const OTHER_CLIENT_DOCUMENT = assessmentId('c2', 1);
const LINK = assessmentId('c3', 1);
const FOREIGN_PRACTITIONER_USER = assessmentId('a7', 1);
const FOREIGN_PRACTITIONER = assessmentId('a7', 2);
const WORDING = assessmentId('a8', 1);

let client: pg.Client;

/** Runs as a signed-in person of this practice, with these roles. */
async function as<T>(userId: string, roles: string, fn: () => Promise<T>): Promise<T> {
  return asApiRole(
    client,
    IDS.tenantA,
    async () => {
      await client.query("select set_config('app.actor_id', $1, true)", [userId]);
      return fn();
    },
    roles,
  );
}

async function visibleAssessments(userId: string, roles: string): Promise<string[]> {
  return as(userId, roles, async () => {
    const { rows } = await client.query<{ id: string }>('select id from assessment order by id');
    return rows.map((row) => row.id);
  });
}

beforeAll(async () => {
  client = await freshDatabase();
  await seedTenant(client, IDS.tenantA, IDS.ownerA, 'Synthetic Studio A');
  await seedTenant(client, IDS.tenantB, IDS.ownerB, 'Synthetic Studio B');
  await seedServiceType(client, IDS.tenantA, SERVICE, 'brain-map');
  await seedServiceType(client, IDS.tenantB, assessmentId('a6', 1), 'brain-map');
  await seedUser(client, {
    id: FOREIGN_PRACTITIONER_USER,
    tenantId: IDS.tenantB,
    authId: null,
    displayName: 'Synthetic Practitioner C',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantB, FOREIGN_PRACTITIONER, FOREIGN_PRACTITIONER_USER);

  // The practitioner whose schedule reaches one client and not the other.
  await seedUser(client, {
    id: MORE_IDS.practitionerUserA,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner A',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, MORE_IDS.practitionerA, MORE_IDS.practitionerUserA);
  await seedUser(client, {
    id: OTHER_PRACTITIONER_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Practitioner B',
    roles: ['practitioner'],
  });
  await seedPractitioner(client, IDS.tenantA, OTHER_PRACTITIONER, OTHER_PRACTITIONER_USER);
  await seedUser(client, {
    id: ADMIN_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Admin',
    roles: ['admin'],
  });
  await seedUser(client, {
    id: FINANCE_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Bookkeeper',
    roles: ['finance'],
  });
  await seedUser(client, {
    id: CONTACT_USER,
    tenantId: IDS.tenantA,
    authId: null,
    displayName: 'Synthetic Parent',
    roles: ['client_contact'],
  });

  await seedClient(client, IDS.tenantA, IDS.clientA, IDS.ownerA, 'Harbour');
  await seedClient(client, IDS.tenantA, OFF_SCHEDULE_CLIENT, IDS.ownerA, 'Lagoon');
  await seedClient(client, IDS.tenantB, IDS.clientB, IDS.ownerB, 'Meadow');
  await seedContact(client, {
    id: CONTACT,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    userId: CONTACT_USER,
  });
  await seedLocation(client, IDS.tenantA, IDS.locationA, IDS.clientA, IDS.ownerA);

  // One client is on practitioner A's schedule; the other never is.
  const { rows } = await client.query<{ today: string }>(
    "select (now() at time zone 'Asia/Dubai')::date::text as today",
  );
  await seedAppointment(client, {
    id: APPOINTMENT,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    practitionerId: MORE_IDS.practitionerA,
    serviceTypeId: SERVICE,
    locationId: IDS.locationA,
    windowStart: `${rows[0]!.today}T08:00:00+04:00`,
  });

  await seedAssessment(client, {
    id: ON_SCHEDULE,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    practitionerId: MORE_IDS.practitionerA,
  });
  await seedAssessment(client, {
    id: OFF_SCHEDULE,
    tenantId: IDS.tenantA,
    clientId: OFF_SCHEDULE_CLIENT,
    practitionerId: MORE_IDS.practitionerA,
  });
  await seedAssessment(client, {
    id: FOREIGN,
    tenantId: IDS.tenantB,
    clientId: IDS.clientB,
    practitionerId: FOREIGN_PRACTITIONER,
  });

  await seedConsentDocument(client, IDS.tenantA, WORDING);

  await seedClientDocument(client, {
    id: DOCUMENT_A,
    tenantId: IDS.tenantA,
    clientId: IDS.clientA,
    digest: 'synthetic-export-a',
  });
  await seedClientDocument(client, {
    id: OTHER_CLIENT_DOCUMENT,
    tenantId: IDS.tenantA,
    clientId: OFF_SCHEDULE_CLIENT,
    digest: 'synthetic-export-b',
  });
  await client.query(
    'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
      "values ($1, $2, $3, $4, $5, 'raw')",
    [LINK, IDS.tenantA, IDS.clientA, ON_SCHEDULE, DOCUMENT_A],
  );

  // asApiRole and rejectsWith both work inside savepoints, so the whole file
  // runs in one transaction and leaves the database as it found it — the shape
  // tests/session/db/rls.test.ts sets.
  await client.query('begin');
});

afterAll(async () => {
  await client.query('rollback');
  await client.end();
});

describe('who may read a measurement', () => {
  it('shows the owner every measurement in the practice', async () => {
    expect(await visibleAssessments(IDS.ownerA, 'owner')).toEqual(
      [ON_SCHEDULE, OFF_SCHEDULE].sort(),
    );
  });

  it('shows an admin every measurement in the practice', async () => {
    expect(await visibleAssessments(ADMIN_USER, 'admin')).toEqual(
      [ON_SCHEDULE, OFF_SCHEDULE].sort(),
    );
  });

  it('shows a lead practitioner every measurement in the practice', async () => {
    expect(await visibleAssessments(ADMIN_USER, 'lead_practitioner')).toEqual(
      [ON_SCHEDULE, OFF_SCHEDULE].sort(),
    );
  });

  it('shows a practitioner only the measurements of a client on their schedule', async () => {
    expect(await visibleAssessments(MORE_IDS.practitionerUserA, 'practitioner')).toEqual([
      ON_SCHEDULE,
    ]);
  });

  it('shows a practitioner off that client’s schedule nothing', async () => {
    expect(await visibleAssessments(OTHER_PRACTITIONER_USER, 'practitioner')).toEqual([]);
  });

  it('shows a client contact nothing, not even for their own client', async () => {
    // Section 4: the household sees nothing until a report is issued, and the
    // rule is the database's rather than a screen's.
    expect(await visibleAssessments(CONTACT_USER, 'client_contact')).toEqual([]);
  });

  it('shows finance nothing', async () => {
    // client-record.md section 2 gives finance demographics and contacts. A
    // brain map is neither.
    expect(await visibleAssessments(FINANCE_USER, 'finance')).toEqual([]);
  });

  it('shows another practice its own measurements and none of this one’s', async () => {
    const seen = await asApiRole(
      client,
      IDS.tenantB,
      async () => {
        await client.query("select set_config('app.actor_id', $1, true)", [IDS.ownerB]);
        const { rows } = await client.query<{ id: string }>('select id from assessment');
        return rows.map((row) => row.id);
      },
      'owner',
    );
    expect(seen).toEqual([FOREIGN]);
    // And the reverse: this practice's owner never sees the other's row.
    expect(await visibleAssessments(IDS.ownerA, 'owner')).not.toContain(FOREIGN);
  });
});

describe('who may read the files behind a measurement', () => {
  async function visibleLinks(userId: string, roles: string): Promise<string[]> {
    return as(userId, roles, async () => {
      const { rows } = await client.query<{ id: string }>('select id from assessment_document');
      return rows.map((row) => row.id);
    });
  }

  it('shows the owner the link', async () => {
    expect(await visibleLinks(IDS.ownerA, 'owner')).toEqual([LINK]);
  });

  it('shows the practitioner whose client it is the link', async () => {
    expect(await visibleLinks(MORE_IDS.practitionerUserA, 'practitioner')).toEqual([LINK]);
  });

  it('shows a practitioner off that schedule nothing', async () => {
    expect(await visibleLinks(OTHER_PRACTITIONER_USER, 'practitioner')).toEqual([]);
  });

  it('shows a client contact nothing', async () => {
    expect(await visibleLinks(CONTACT_USER, 'client_contact')).toEqual([]);
  });

  it('shows finance nothing', async () => {
    expect(await visibleLinks(FINANCE_USER, 'finance')).toEqual([]);
  });
});

describe('what the API role may do to a measurement', () => {
  it('records one against its own practitioner row for a client on its schedule', async () => {
    await as(MORE_IDS.practitionerUserA, 'practitioner', async () => {
      await client.query('savepoint recorded');
      await client.query(
        'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
          "performed_at, instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
        [assessmentId('d1', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA],
      );
      await client.query('rollback to savepoint recorded');
    });
  });

  it("refuses a measurement recorded in another practitioner's name", async () => {
    await as(MORE_IDS.practitionerUserA, 'practitioner', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
          "performed_at, instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
        [assessmentId('d2', 1), IDS.tenantA, IDS.clientA, OTHER_PRACTITIONER],
      );
    });
  });

  it('refuses a measurement for a client off that practitioner’s schedule', async () => {
    await as(MORE_IDS.practitionerUserA, 'practitioner', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
          "performed_at, instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
        [assessmentId('d3', 1), IDS.tenantA, OFF_SCHEDULE_CLIENT, MORE_IDS.practitionerA],
      );
    });
  });

  it('refuses an admin recording one, who may file an export and may not take a measurement', async () => {
    await as(ADMIN_USER, 'admin', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
          "performed_at, instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
        [assessmentId('d4', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA],
      );
    });
  });

  it('refuses a client contact recording one', async () => {
    await as(CONTACT_USER, 'client_contact', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
          "performed_at, instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
        [assessmentId('d5', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA],
      );
    });
  });

  it('refuses an update, because a measurement is corrected by a new version', async () => {
    await as(IDS.ownerA, 'owner', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'update assessment set condition_note = $1 where id = $2',
        ['rewritten', ON_SCHEDULE],
      );
    });
  });

  it('refuses a delete', async () => {
    await as(IDS.ownerA, 'owner', async () => {
      await rejectsWith(client, RLS_VIOLATION, 'delete from assessment where id = $1', [
        ON_SCHEDULE,
      ]);
    });
  });

  it('refuses an update even from the practice’s own owner at the database', async () => {
    // The grant is what stops the API; this trigger is what stops everything
    // else that can reach the table (migration 500 section 2).
    await rejectsWith(
      client,
      RESTRICT_VIOLATION,
      'update assessment set condition_note = $1 where id = $2',
      ['rewritten', ON_SCHEDULE],
    );
    await rejectsWith(client, RESTRICT_VIOLATION, 'delete from assessment where id = $1', [
      ON_SCHEDULE,
    ]);
  });
});

describe('the link between a measurement and its files', () => {
  it('refuses a link naming another client’s document', async () => {
    // Section 11: the composite key binds the link to the assessment's own
    // client, and the guard binds that client to the document's.
    await rejectsWith(
      client,
      FK_VIOLATION,
      'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
        "values ($1, $2, $3, $4, $5, 'raw')",
      [assessmentId('e1', 1), IDS.tenantA, IDS.clientA, ON_SCHEDULE, OTHER_CLIENT_DOCUMENT],
    );
  });

  it('refuses a link claiming a client the assessment does not have', async () => {
    await rejectsWith(
      client,
      FK_VIOLATION,
      'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
        "values ($1, $2, $3, $4, $5, 'raw')",
      [assessmentId('e2', 1), IDS.tenantA, OFF_SCHEDULE_CLIENT, ON_SCHEDULE, OTHER_CLIENT_DOCUMENT],
    );
  });

  it('refuses the same document filed twice', async () => {
    await rejectsWith(
      client,
      '23505',
      'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
        "values ($1, $2, $3, $4, $5, 'vendor_report')",
      [assessmentId('e3', 1), IDS.tenantA, IDS.clientA, ON_SCHEDULE, DOCUMENT_A],
    );
  });

  it('gives the API role no way to write a link at all', async () => {
    await as(MORE_IDS.practitionerUserA, 'practitioner', async () => {
      await rejectsWith(
        client,
        RLS_VIOLATION,
        'insert into assessment_document (id, tenant_id, client_id, assessment_id, document_id, role) ' +
          "values ($1, $2, $3, $4, $5, 'raw')",
        [assessmentId('e4', 1), IDS.tenantA, IDS.clientA, ON_SCHEDULE, DOCUMENT_A],
      );
      await rejectsWith(client, RLS_VIOLATION, 'delete from assessment_document where id = $1', [
        LINK,
      ]);
    });
  });
});

describe('the constraints a measurement carries', () => {
  it('refuses a correction with no reason', async () => {
    await rejectsWith(
      client,
      '23514',
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        'instrument, instrument_version, derived, version, supersedes_id) ' +
        "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, 2, $5)",
      [assessmentId('f1', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, ON_SCHEDULE],
    );
  });

  it('refuses a first recording that claims to replace something', async () => {
    await rejectsWith(
      client,
      '23514',
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        'instrument, instrument_version, derived, supersedes_id, supersede_reason) ' +
        "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, $5, 'A reason.')",
      [assessmentId('f2', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, ON_SCHEDULE],
    );
  });

  it('refuses two corrections of the same version', async () => {
    await client.query('savepoint two_tips');
    await client.query(
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        'instrument, instrument_version, derived, version, supersedes_id, supersede_reason) ' +
        "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, 2, $5, 'The first correction.')",
      [assessmentId('f3', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, ON_SCHEDULE],
    );
    await rejectsWith(
      client,
      '23505',
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        'instrument, instrument_version, derived, version, supersedes_id, supersede_reason) ' +
        "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, 2, $5, 'A second correction.')",
      [assessmentId('f4', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA, ON_SCHEDULE],
    );
    await client.query('rollback to savepoint two_tips');
  });

  it('refuses a reference age outside a human lifetime', async () => {
    await rejectsWith(
      client,
      '23514',
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        'instrument, instrument_version, derived, reference_age_years) ' +
        "values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb, 900)",
      [assessmentId('f5', 1), IDS.tenantA, IDS.clientA, MORE_IDS.practitionerA],
    );
  });

  it('refuses a measurement of another practice’s client', async () => {
    await rejectsWith(
      client,
      FK_VIOLATION,
      'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, performed_at, ' +
        "instrument, instrument_version, derived) values ($1, $2, $3, $4, now(), 'qeeg', '1', '{}'::jsonb)",
      [assessmentId('f6', 1), IDS.tenantA, IDS.clientB, MORE_IDS.practitionerA],
    );
  });

  it('says it is audited against a client, and carries the trigger', async () => {
    const { rows } = await client.query<{ description: string | null; triggers: number }>(
      "select obj_description('public.assessment'::regclass, 'pg_class') as description, " +
        "(select count(*)::int from pg_trigger where tgrelid = 'public.assessment'::regclass " +
        "and tgname = 'audit_row') as triggers",
    );
    expect(rows[0]?.description).toBe('audited: client');
    expect(rows[0]?.triggers).toBe(1);
    const link = await client.query<{ description: string | null; triggers: number }>(
      "select obj_description('public.assessment_document'::regclass, 'pg_class') as description, " +
        "(select count(*)::int from pg_trigger where tgrelid = 'public.assessment_document'::regclass " +
        "and tgname = 'audit_row') as triggers",
    );
    expect(link.rows[0]?.description).toBe('audited: client');
    expect(link.rows[0]?.triggers).toBe(1);
  });
});

/** An instant either side of now, as a timestamp the column takes. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('the door the recording gate reads', () => {
  type Context = {
    client_found: boolean;
    visible: boolean;
    active_consent_purposes: string[];
  };

  async function contextFor(userId: string, roles: string, clientId: string): Promise<Context> {
    return as(userId, roles, async () => {
      const { rows } = await client.query<Context>(
        'select client_found, visible, active_consent_purposes ' +
          "from app.assessment_context($1, 'brain-map')",
        [clientId],
      );
      return rows[0]!;
    });
  }

  /** Consents for the client on the schedule, taken away again afterwards. */
  async function withConsents<T>(
    rows: readonly { purpose: 'participation' | 'home_visit'; expiresAt?: string | null }[],
    fn: () => Promise<T>,
  ): Promise<T> {
    await client.query('savepoint consents');
    try {
      for (const [index, row] of rows.entries()) {
        await seedConsent(client, {
          id: assessmentId('d1', 10 + index),
          tenantId: IDS.tenantA,
          clientId: IDS.clientA,
          givenByContactId: CONTACT,
          purpose: row.purpose,
          textDocumentId: WORDING,
          expiresAt: row.expiresAt ?? null,
        });
      }
      return await fn();
    } finally {
      await client.query('rollback to savepoint consents');
    }
  }

  it('counts a consent active only while it has not run out', async () => {
    // `status` is what a person did and `expires_at` is what time did. A
    // participation agreement that ran out last month still says 'active', and
    // reading the status alone would let it admit this afternoon's recording —
    // which is the drift asking the gates at the moment of writing exists to
    // prevent. app.checkin_context (301) asks both; so does this door.
    const answer = await withConsents(
      [{ purpose: 'participation', expiresAt: daysFromNow(-30) }, { purpose: 'home_visit' }],
      async () => contextFor(MORE_IDS.practitionerUserA, 'practitioner', IDS.clientA),
    );
    expect(answer.visible).toBe(true);
    expect(answer.active_consent_purposes).toEqual(['home_visit']);
  });

  it('counts one that has not run out, and one with no end at all', async () => {
    const answer = await withConsents(
      [{ purpose: 'participation', expiresAt: daysFromNow(30) }, { purpose: 'home_visit' }],
      async () => contextFor(MORE_IDS.practitionerUserA, 'practitioner', IDS.clientA),
    );
    expect([...answer.active_consent_purposes].sort()).toEqual(['home_visit', 'participation']);
  });
});
