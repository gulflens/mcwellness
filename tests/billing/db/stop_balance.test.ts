import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StopBalanceResponse } from '../../../app/api/billing/document-schema';
import type { BalanceResponse } from '../../../app/api/billing/ledger-schema';
import { SEED_TODAY } from '../../../db/seed/generate';
import {
  SEEDED,
  setPracticePrices,
  silverInput,
  SILVER_CODE,
  startHarness,
  type Harness,
} from './support';

/**
 * The stop card's own balance route, and what it deliberately does not answer.
 *
 * A practitioner is entitled to both figures the card shows — "Session 3 of 15"
 * and what is owed at the door — and row security decides which client they may
 * ask about. What was wrong was never the permission but the size of the
 * answer: the full balance route hands back the practice's whole commercial
 * position, and that has no business sitting in a phone on somebody's doorstep.
 *
 * So the assertion that matters is the negative one, and it is written against
 * the keys of the response rather than against a list of fields somebody
 * remembered to check.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-0000000000fc';

/** A synthetic contact who signs in, from the reserved id range. */
const CONTACT_USER_ID = '00000002-0000-4000-8000-0000000000c1';
const CONTACT_AUTH_ID = '00000002-0000-4000-8000-0000000000c2';

let h: Harness;
let clientId: string;

async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, REQUEST_ID],
  );
}

/**
 * Puts the shared connection back to no role at all.
 *
 * `set_config(..., false)` is session-wide, not transaction-local, so a fixture
 * that acts as a practitioner leaves every later statement in the file acting as
 * one — including the ones that create a signing contact below, which are the
 * practice's own maintenance and nobody's role. Every guard trigger in this
 * schema stands aside when no role is stamped, and that is the state a fixture
 * should hand back.
 */
async function asNobody(): Promise<void> {
  await h.owner.query(
    "select set_config('app.actor_roles', '', false), set_config('app.actor_id', '', false)",
  );
}

let sessionSeq = 0;

async function deliverVisit(client: string): Promise<void> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000a${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, client, practitioner?.id, h.serviceTypeId('nf-session')],
  );
  await asNobody();
}

/**
 * A visit on the practitioner's own schedule, which is what
 * `app.client_visible_to_practitioner` reads: ninety days back, thirty forward,
 * confirmed visits only (201_client_visible_to_practitioner.sql).
 */
async function scheduleVisit(client: string): Promise<void> {
  // The practitioner who will *ask*, not the first one seeded: the door checks
  // that the acting user is the practitioner on the appointment, and the owner
  // holds practitioners[0].
  const practitioner = h.data.practitioners[SEEDED.practitioner];
  // Scheduled from the database's own clock, not a date written down here.
  // app.client_visible_to_practitioner measures its window — ninety days back,
  // thirty forward — from `now()` in Postgres, while the harness injects a
  // different clock into the API. A fixed date passes today and silently stops
  // being inside the window as the calendar moves, which is a test that fails
  // for a reason that has nothing to do with the code.
  await h.owner.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) ' +
      "select $1, $2, $3, $4, $5, l.id, 'home', now(), " +
      "now() + interval '45 minutes', 'confirmed' " +
      'from location l where l.owner_type = $6 and l.owner_id = $3 limit 1',
    [
      '00000000-0000-4000-8000-00000000a900',
      h.data.tenant.id,
      client,
      practitioner?.id,
      h.serviceTypeId('nf-session'),
      'client',
    ],
  );
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
  clientId = h.clientId(0);

  const created = await h.call(
    'POST',
    '/api/billing/packages',
    SEEDED.owner,
    silverInput(h, SEED_TODAY),
    { 'x-reason': "The practice's own launch pricing." },
  );
  if (created.status !== 201) throw new Error('Silver was not created.');
  const listed = await h.call('GET', '/api/billing/packages', SEEDED.owner);
  const packages = (await listed.json()) as { packages: { id: string; code: string }[] };
  const silver = packages.packages.find((p) => p.code === SILVER_CODE);
  if (!silver) throw new Error('Silver was not in the catalogue.');

  const sold = await h.call('POST', '/api/billing/package-purchases', SEEDED.owner, {
    packageId: silver.id,
    clientId,
    purchasedOn: SEED_TODAY,
  });
  if (sold.status !== 201) throw new Error('Silver was not sold.');

  await deliverVisit(clientId);
  await scheduleVisit(clientId);
  await asNobody();

  // A contact of this household who signs in, so the client-contact door is
  // tested against a real actor rather than argued about.
  await h.owner.query(
    'insert into app_user (id, tenant_id, auth_id, display_name) values ($1, $2, $3, $4)',
    [CONTACT_USER_ID, h.data.tenant.id, CONTACT_AUTH_ID, 'Synthetic Contact'],
  );
  await h.owner.query(
    "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
    [h.data.tenant.id, CONTACT_USER_ID],
  );
  await h.owner.query(
    'update contact set user_id = $1 where id = (select id from contact where client_id = $2 ' +
      'order by id limit 1)',
    [CONTACT_USER_ID, clientId],
  );
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('the stop card’s balance', () => {
  it('answers a practitioner the counts and what is owed, for a client on their schedule', async () => {
    const res = await h.call(
      'GET',
      `/api/billing/clients/${clientId}/stop-balance`,
      SEEDED.practitioner,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as StopBalanceResponse;

    const sessions = body.services.find((s) => s.serviceTypeCode === 'nf-session');
    // "Session 1 of 15", and fourteen still to come.
    expect(sessions).toEqual({
      serviceTypeCode: 'nf-session',
      delivered: 1,
      purchased: 15,
      remaining: 14,
    });
    expect(body.outstandingFils).toBe(1_032_500);
  });

  it('answers those fields and nothing else at all', async () => {
    const res = await h.call(
      'GET',
      `/api/billing/clients/${clientId}/stop-balance`,
      SEEDED.practitioner,
    );
    const body = (await res.json()) as Record<string, unknown>;

    // Written against the keys, not against a list of fields somebody
    // remembered to check: a field added to this route later fails here.
    expect(Object.keys(body).sort()).toEqual(['clientId', 'outstandingFils', 'services']);
    for (const service of body.services as Record<string, unknown>[]) {
      expect(Object.keys(service).sort()).toEqual([
        'delivered',
        'purchased',
        'remaining',
        'serviceTypeCode',
      ]);
    }

    // And none of the commercial position the console's route carries.
    const written = JSON.stringify(body);
    for (const absent of [
      'netFils',
      'vatFils',
      'listPriceFils',
      'grossFils',
      'recognisedNetFils',
      'deferredNetFils',
      'remainingValueNetFils',
      'chargedFils',
      'paidFils',
      'purchases',
      'invoiceId',
      'discountReason',
      'expiresOn',
      'serviceTypeId',
    ]) {
      expect(written, absent).not.toContain(absent);
    }
  });

  it('records the read, exactly as the full balance route does', async () => {
    const before = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'billing_ledger' and entity_id = $1",
      [clientId],
    );
    await h.call('GET', `/api/billing/clients/${clientId}/stop-balance`, SEEDED.practitioner);
    const after = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'billing_ledger' and entity_id = $1",
      [clientId],
    );
    expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n) + 1);
  });

  it('is not there for a client who is not on that practitioner’s schedule', async () => {
    // An empty ledger and a 404, never a refusal that confirms the record
    // exists (201_client_visible_to_practitioner.sql).
    const res = await h.call(
      'GET',
      `/api/billing/clients/${h.clientId(9)}/stop-balance`,
      SEEDED.practitioner,
    );
    expect(res.status).toBe(404);
  });
});

describe('everyone else gets the answer they got before', () => {
  it('answers finance the same counts, and leaves the console’s own route alone', async () => {
    const narrow = await h.call(
      'GET',
      `/api/billing/clients/${clientId}/stop-balance`,
      SEEDED.owner,
    );
    expect(narrow.status).toBe(200);
    const stop = (await narrow.json()) as StopBalanceResponse;

    const full = await h.call('GET', `/api/billing/clients/${clientId}/balance`, SEEDED.owner);
    expect(full.status).toBe(200);
    const balance = (await full.json()) as BalanceResponse;

    // The two are readings of one ledger and must not be able to disagree.
    const stopSessions = stop.services.find((s) => s.serviceTypeCode === 'nf-session');
    const fullSessions = balance.services.find((s) => s.serviceTypeCode === 'nf-session');
    expect(stopSessions?.delivered).toBe(fullSessions?.delivered);
    expect(stopSessions?.purchased).toBe(fullSessions?.purchased);
    expect(stopSessions?.remaining).toBe(fullSessions?.remaining);
    expect(stop.outstandingFils).toBe(balance.outstandingFils);

    // And the console still gets the whole picture.
    expect(balance.purchases).toHaveLength(1);
    expect(balance.deferredNetFils).toBeGreaterThan(0);
  });

  it('refuses a client contact, exactly as the full balance route does', async () => {
    // Both routes pass no `clientIds`: resolving a contact's own household is
    // the portal stream's, and until it exists a contact is refused rather than
    // quietly shown a household that may not be theirs.
    const narrow = await h.callAs(
      'GET',
      `/api/billing/clients/${clientId}/stop-balance`,
      CONTACT_AUTH_ID,
    );
    const full = await h.callAs('GET', `/api/billing/clients/${clientId}/balance`, CONTACT_AUTH_ID);
    expect(narrow.status).toBe(403);
    expect(full.status).toBe(narrow.status);
  });
});
