import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AgreementsResponse, MarketingResponse } from '../../../app/api/portal/schema';
import { IDS } from '../../db/helpers';
import {
  PORTAL,
  seedConsent,
  seedWording,
  startPortalHarness,
  type PortalHarness,
} from './support';

/**
 * The marketing switch's routes, through `createApi` as the server builds it
 * (the push memo's decision 1; migration 706; docs/CONSENT/marketing.en.md).
 * Every row here is invented and names nobody.
 */

const W = {
  en: '00000001-0000-4000-8000-0000000000a1',
  ar: '00000001-0000-4000-8000-0000000000a2',
  draft: '00000001-0000-4000-8000-0000000000a3',
  participation: '00000001-0000-4000-8000-0000000000a4',
  participationConsent: '00000001-0000-4000-8000-0000000000a5',
} as const;

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
  for (const [id, locale] of [
    [W.en, 'en'],
    [W.ar, 'ar'],
  ] as const) {
    await seedWording(h.owner, {
      id,
      purpose: 'marketing',
      locale,
      version: '1.0',
      status: 'approved',
    });
  }
  await seedWording(h.owner, {
    id: W.draft,
    purpose: 'marketing',
    locale: 'en',
    version: '1.1-draft',
    status: 'draft',
  });
  await seedWording(h.owner, {
    id: W.participation,
    purpose: 'participation',
    locale: 'en',
    version: '1.0',
    status: 'approved',
  });
  await seedConsent(h.owner, {
    id: W.participationConsent,
    clientId: PORTAL.childA,
    contactId: PORTAL.motherContact,
    purpose: 'participation',
    wordingId: W.participation,
  });
});

afterAll(async () => {
  await h?.close();
});

async function marketing(authId: string): Promise<MarketingResponse> {
  const res = await h.callAs('GET', '/api/portal/marketing', authId);
  expect(res.status).toBe(200);
  return (await res.json()) as MarketingResponse;
}

async function rowsOf(userContactIds: string[]) {
  const rows = await h.owner.query<{ status: string; method: string; client_id: string }>(
    "select status::text as status, method::text as method, client_id from consent where purpose = 'marketing' " +
      'and given_by_contact_id = any($1::uuid[]) order by client_id, given_at',
    [userContactIds],
  );
  return rows.rows;
}

describe('the switch, read', () => {
  it('is offered to an adult, off until they turn it on, beside the wording in both languages', async () => {
    expect(await marketing(PORTAL.motherAuth)).toEqual({
      offered: true,
      state: 'never',
      since: null,
      wordings: { en: { id: W.en, version: '1.0' }, ar: { id: W.ar, version: '1.0' } },
    });
  });

  it("is never offered to a young person's own login", async () => {
    expect((await marketing(PORTAL.minorAuth)).offered).toBe(false);
  });

  it('is not the practice’s to read: a member of staff is refused', async () => {
    const res = await h.callAs('GET', '/api/portal/marketing', PORTAL.adminAuth);
    expect(res.status).toBe(403);
  });

  it('opens the wording as a short-lived link, logged as read', async () => {
    const res = await h.callAs('GET', '/api/portal/marketing/wording/ar', PORTAL.adultAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; version: string; textUrl: string };
    expect(body.id).toBe(W.ar);
    expect(body.version).toBe('1.0');
    expect(body.textUrl).toContain(W.ar);
    const read = await h.owner.query(
      "select 1 from audit_log where entity_type = 'document' and entity_id = $1 and actor_id = $2",
      [W.ar, PORTAL.adultUser],
    );
    expect(read.rowCount).toBeGreaterThan(0);
  });
});

describe('turning it on and off', () => {
  it('turns it on against the wording read, one row on each of the person’s records', async () => {
    const res = await h.callAs('POST', '/api/portal/marketing', PORTAL.motherAuth, {
      wordingId: W.en,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as MarketingResponse;
    expect(body.state).toBe('on');
    expect(body.since).not.toBeNull();
    expect(await rowsOf([PORTAL.motherContact, PORTAL.motherSecondContact])).toEqual([
      { status: 'active', method: 'portal_switch', client_id: PORTAL.childA },
      { status: 'active', method: 'portal_switch', client_id: PORTAL.childB },
    ]);
    const trail = await h.owner.query<{ action: string; reason: string | null }>(
      "select action, reason from audit_log where entity_type = 'consent' and action in " +
        "('insert', 'portal.marketing.given') and actor_id = $1 order by id",
      [PORTAL.motherUser],
    );
    expect(trail.rows.map((row) => row.action).sort()).toEqual([
      'insert',
      'insert',
      'portal.marketing.given',
      'portal.marketing.given',
    ]);
    expect(
      trail.rows.every((row) => row.reason === 'marketing consent turned on in the portal'),
    ).toBe(true);
  });

  it('refuses a second turning on while it stands', async () => {
    const res = await h.callAs('POST', '/api/portal/marketing', PORTAL.motherAuth, {
      wordingId: W.en,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('already_given');
  });

  it('keeps it off the record’s own list of agreements, which the switch stands above', async () => {
    const res = await h.callAs('GET', '/api/portal/agreements', PORTAL.motherAuth);
    const body = (await res.json()) as AgreementsResponse;
    expect(body.agreements.map((row) => row.purpose)).toEqual(['participation']);
  });

  it('turns it off with one press, every row at once', async () => {
    const res = await h.callAs('POST', '/api/portal/marketing/withdraw', PORTAL.motherAuth);
    expect(res.status).toBe(200);
    expect(((await res.json()) as MarketingResponse).state).toBe('off');
    expect(
      (await rowsOf([PORTAL.motherContact, PORTAL.motherSecondContact])).map((row) => row.status),
    ).toEqual(['withdrawn', 'withdrawn']);
  });

  it('says so when there is nothing to turn off', async () => {
    const res = await h.callAs('POST', '/api/portal/marketing/withdraw', PORTAL.motherAuth);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('not_given');
  });

  it('refuses a wording that is not the current approved one', async () => {
    for (const wordingId of [W.draft, W.participation]) {
      const res = await h.callAs('POST', '/api/portal/marketing', PORTAL.adultAuth, { wordingId });
      expect(res.status, wordingId).toBe(422);
    }
  });

  it("refuses a young person's own login, and a member of staff", async () => {
    const minor = await h.callAs('POST', '/api/portal/marketing', PORTAL.minorAuth, {
      wordingId: W.en,
    });
    expect(minor.status).toBe(403);
    const staff = await h.callAs('POST', '/api/portal/marketing', PORTAL.adminAuth, {
      wordingId: W.en,
    });
    expect(staff.status).toBe(403);
    expect(await rowsOf([PORTAL.minorContact])).toEqual([]);
  });

  it('never belongs to another practice', async () => {
    const other = await h.owner.query(
      "select 1 from consent where purpose = 'marketing' and tenant_id = $1",
      [IDS.tenantB],
    );
    expect(other.rowCount).toBe(0);
  });
});
