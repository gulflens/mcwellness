import { SignJWT } from 'jose';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../../app/api/_middleware/db';
import { createTokenVerifier } from '../../app/api/_middleware/token-verifier';
import { createApi } from '../../app/api/create-api';
import type { PracticeResponse } from '../../app/api/practice/schema';
import { applySeed } from '../../db/seed/apply';
import { generateSeed } from '../../db/seed/generate';
import { deriveIdentityKeys } from '../../domain/shared/identity';
import { freshDatabase } from './helpers';

/**
 * `GET` and `PATCH /api/practice` against a real database, through the API
 * the server actually builds (migration 905, app/api/practice/routes.ts).
 *
 * Four things: who may open it, that a save without a reason is refused
 * before anything moves, that the VAT switch and its number cannot be
 * recorded by halves, and that a save lands on the row and on the trail.
 */

const SECRET = 'test-secret-that-unlocks-nothing-0123456789';
const ISSUER = 'http://localhost:54321/auth/v1';
const KEY = new TextEncoder().encode(SECRET);
const data = generateSeed();
// Fifteen digits in the reserved synthetic shape; never a real registration.
const VAT_TRN = '100000000000003';

let owner: pg.Client;
let pool: pg.Pool;
let api: ReturnType<typeof createApi>;

/** The seeded people: 0 holds every office role, 1 and 2 only treat, 3 is an admin. */
function authIdOf(index: number): string {
  const user = data.users[index];
  if (!user) throw new Error(`No seeded user ${index}.`);
  return user.authId;
}

async function mint(sub: string): Promise<string> {
  return new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience('authenticated')
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(KEY);
}

async function call(
  method: 'GET' | 'PATCH',
  sub: string,
  options: { body?: unknown; reason?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = { authorization: `Bearer ${await mint(sub)}` };
  if (options.reason !== undefined) {
    headers['x-reason'] = options.reason;
  }
  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }
  return api.request('/api/practice', init);
}

async function read(sub: string): Promise<PracticeResponse['practice']> {
  const res = await call('GET', sub);
  expect(res.status).toBe(200);
  return ((await res.json()) as PracticeResponse).practice;
}

/** The whole form, as the drawer sends it: a saved change starts from what is there. */
async function form(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const practice = await read(authIdOf(0));
  return {
    legalName: practice.legalName,
    legalNameAr: practice.legalNameAr ?? '',
    taxRegistrationNumber: practice.taxRegistrationNumber ?? '',
    licenceNumber: practice.licenceNumber ?? '',
    licensingAuthority: practice.licensingAuthority ?? '',
    licenceExpiresOn: practice.licenceExpiresOn,
    vatRegistered: practice.vatRegistered,
    vatTrn: practice.vatTrn ?? '',
    whatsappNumber: practice.whatsappNumber ?? '',
    address: practice.address,
    ...overrides,
  };
}

beforeAll(async () => {
  owner = await freshDatabase();
  await applySeed(owner, data, deriveIdentityKeys(Buffer.alloc(32, 7)));
  const apiUrl = process.env.API_DATABASE_URL;
  if (!apiUrl) throw new Error('API_DATABASE_URL is not set.');
  pool = createPool(apiUrl);
  api = createApi({ pool, verifier: createTokenVerifier({ issuer: ISSUER, secret: SECRET }) });
});

afterAll(async () => {
  await pool.end();
  await owner.end();
});

describe('GET /api/practice', () => {
  it('answers the owner with the practice, its address and its VAT state', async () => {
    const practice = await read(authIdOf(0));
    expect(practice.legalName).toBe(data.tenant.legalName);
    expect(practice.taxRegistrationNumber).toBe(data.tenant.trn);
    expect(practice.vatRegistered).toBe(false);
    expect(practice.vatTrn).toBeNull();
    expect(practice.address?.displayAddress).toBe('Unit 1, Synthetic Tower, Dubai');
    expect(practice.address?.emirate).toBe('DXB');
  });

  it('answers an admin, and refuses a practitioner', async () => {
    expect((await call('GET', authIdOf(3))).status).toBe(200);
    expect((await call('GET', authIdOf(1))).status).toBe(403);
  });
});

describe('PATCH /api/practice', () => {
  it('refuses a practitioner before it reads a body at all', async () => {
    const res = await call('PATCH', authIdOf(1), {
      body: await form({ legalName: 'Renamed By Somebody Else' }),
      reason: 'trying it on',
    });
    expect(res.status).toBe(403);
    expect((await read(authIdOf(0))).legalName).toBe(data.tenant.legalName);
  });

  it('refuses a save that says nothing about why', async () => {
    const res = await call('PATCH', authIdOf(0), { body: await form() });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'reason_required' });
  });

  it('refuses the VAT switch without the number that would be printed', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: true, vatTrn: '' }),
      reason: 'registering for VAT',
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'vat_trn_required' });
    expect((await read(authIdOf(0))).vatRegistered).toBe(false);
  });

  it('refuses a VAT number that is not fifteen digits', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: true, vatTrn: '1234' }),
      reason: 'registering for VAT',
    });
    expect(res.status).toBe(400);
    expect((await read(authIdOf(0))).vatRegistered).toBe(false);
  });

  it('saves the identity, the licence and the registration, and records why', async () => {
    const reason = 'The licence was reissued and the practice registered for VAT.';
    const res = await call('PATCH', authIdOf(3), {
      body: await form({
        legalNameAr: 'استوديو العافية',
        licenceNumber: 'SYN-000123',
        licensingAuthority: 'Synthetic Department of Economy and Tourism',
        licenceExpiresOn: '2028-06-30',
        vatRegistered: true,
        vatTrn: VAT_TRN,
      }),
      reason,
    });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PracticeResponse).practice;
    expect(saved).toMatchObject({
      legalNameAr: 'استوديو العافية',
      licenceNumber: 'SYN-000123',
      licenceExpiresOn: '2028-06-30',
      vatRegistered: true,
      vatTrn: VAT_TRN,
    });
    // Read back through a second request, not from the answer to the first.
    expect(await read(authIdOf(0))).toMatchObject({ vatRegistered: true, vatTrn: VAT_TRN });

    // Sensitive, so the trail carries the reason with the row it changed.
    const { rows } = await owner.query<{ reason: string | null }>(
      "select reason from audit_log where entity_type = 'tenant' and action = 'update' " +
        'order by id desc limit 1',
    );
    expect(rows[0]?.reason).toBe(reason);
  });

  it('turns the registration off and takes the number with it', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({ vatRegistered: false, vatTrn: '' }),
      reason: 'The registration was cancelled by the authority.',
    });
    expect(res.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({ vatRegistered: false, vatTrn: null });
  });

  it("records the practice's own WhatsApp number, and refuses one that is not E.164", async () => {
    // What the client portal's ask-for-a-visit button opens (migration 910,
    // docs/SPEC/client-portal.md section 6.4).
    const refused = await call('PATCH', authIdOf(0), {
      reason: 'The practice number changed.',
      body: await form({ whatsappNumber: '0501234' }),
    });
    expect(refused.status).toBe(400);
    expect((await refused.json()) as { code?: string }).toMatchObject({
      code: 'whatsapp_number_invalid',
    });

    const saved = await call('PATCH', authIdOf(0), {
      reason: 'The practice number changed.',
      body: await form({ whatsappNumber: '+971 50 000 0024' }),
    });
    expect(saved.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({ whatsappNumber: '+971500000024' });

    // And cleared again: a practice that records none shows the portal's
    // sentence without a button.
    await call('PATCH', authIdOf(0), {
      reason: 'The practice has no WhatsApp number for now.',
      body: await form({ whatsappNumber: '' }),
    });
    expect(await read(authIdOf(0))).toMatchObject({ whatsappNumber: null });
  });

  it('saves the registered address onto the practice’s own location row', async () => {
    const res = await call('PATCH', authIdOf(0), {
      body: await form({
        address: {
          displayAddress: 'Unit 2, Synthetic Tower, Dubai',
          emirate: 'DXB',
          latitude: 25.191,
          longitude: 55.261,
        },
      }),
      reason: 'The studio moved a floor up.',
    });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PracticeResponse).practice;
    expect(saved.address?.displayAddress).toBe('Unit 2, Synthetic Tower, Dubai');
    expect(saved.address?.latitude).toBeCloseTo(25.191, 5);

    // The same row an invoice's supplier address is stamped from.
    const { rows } = await owner.query<{ display_address: string }>(
      'select l.display_address from tenant t join location l on l.id = t.location_id',
    );
    expect(rows[0]?.display_address).toBe('Unit 2, Synthetic Tower, Dubai');
  });
});

/**
 * The three facts printed in the footer of every document the practice issues
 * (migration 912, docs/SPEC/billing.md section 5.6).
 *
 * They are optional on this form: a save that omits them leaves them exactly
 * as they are rather than clearing three columns its sender never showed
 * anybody. One that sends them as null clears them (below).
 */
describe('the practice’s contact details', () => {
  it('are absent until somebody records them', async () => {
    expect(await read(authIdOf(0))).toMatchObject({
      contactPhone: null,
      contactEmail: null,
      website: null,
    });
  });

  it('are saved, and then left alone by a save that does not mention them', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: "Putting the practice's own details on its documents.",
      body: await form({
        contactPhone: '+971 50 000 0011',
        contactEmail: 'studio@example.com',
        website: 'https://example.com',
      }),
    });
    expect(res.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({
      contactPhone: '+971 50 000 0011',
      contactEmail: 'studio@example.com',
      website: 'https://example.com',
    });

    // The settings screen's own body, which carries none of the three.
    await call('PATCH', authIdOf(0), {
      reason: 'An ordinary save from the settings screen.',
      body: await form({ legalNameAr: 'استوديو العافية التجريبي' }),
    });
    expect(await read(authIdOf(0))).toMatchObject({
      contactPhone: '+971 50 000 0011',
      website: 'https://example.com',
    });
  });

  it('refuse a value that is plainly in the wrong field', async () => {
    for (const wrong of [
      { website: 'example.com' },
      { contactEmail: 'not an address' },
      { contactPhone: 'ring the studio' },
    ]) {
      const res = await call('PATCH', authIdOf(0), {
        reason: 'Trying a value the column would refuse.',
        body: await form(wrong),
      });
      expect(res.status).toBe(400);
    }
  });
});

/**
 * The practice's bank account (migration 924, round 61): what an invoice's
 * "Payment details" card prints. Invented values only — a UAE-shaped
 * IBAN with an all-zero bank code and a sequential account, its check digits
 * computed so it passes mod 97, and a BIC in the shape of none.
 */
describe('the practice’s bank account', () => {
  const BANK = {
    accountHolder: 'Example Practice L.L.C-FZ',
    iban: 'ae36 0000 0000 0000 0000 001',
    bic: 'testaexx',
    bankAddress: '1 Example Street, Abu Dhabi',
  };

  it('is absent until somebody records it', async () => {
    expect((await read(authIdOf(0))).bank).toBeNull();
  });

  it('records the bank account and answers it back, IBAN stored without spaces', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Putting the bank details on the invoice.',
      body: await form({ bank: BANK }),
    });
    expect(res.status).toBe(200);
    expect((await read(authIdOf(0))).bank).toEqual({
      accountHolder: 'Example Practice L.L.C-FZ',
      iban: 'AE360000000000000000001',
      bic: 'TESTAEXX',
      bankAddress: '1 Example Street, Abu Dhabi',
    });
    const { rows } = await owner.query<{ bank_iban: string }>('select bank_iban from tenant');
    expect(rows[0]?.bank_iban).toBe('AE360000000000000000001');

    // A save that never mentions the bank leaves it exactly as it stands.
    await call('PATCH', authIdOf(0), {
      reason: 'An ordinary save that never mentions the bank.',
      body: await form({ legalNameAr: 'استوديو العافية' }),
    });
    expect((await read(authIdOf(0))).bank?.iban).toBe('AE360000000000000000001');
  });

  it('refuses an IBAN of the wrong shape', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying a value the column would refuse.',
      body: await form({ bank: { ...BANK, iban: 'AE07 0000' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'iban_invalid' });
    expect((await read(authIdOf(0))).bank?.iban).toBe('AE360000000000000000001');
  });

  it('refuses an IBAN whose check digits do not agree', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying a mistyped IBAN.',
      body: await form({ bank: { ...BANK, iban: 'AE37 0000 0000 0000 0000 001' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'iban_invalid' });
    expect((await read(authIdOf(0))).bank?.iban).toBe('AE360000000000000000001');
  });

  it('refuses a BIC of the wrong shape', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying a value the column would refuse.',
      body: await form({ bank: { ...BANK, bic: 'TEST' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'bic_invalid' });
  });

  it('refuses a BIC without an IBAN', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying half a bank account.',
      body: await form({
        bank: { accountHolder: null, iban: null, bic: 'TESTAEXX', bankAddress: null },
      }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'iban_required' });
  });

  it('refuses an IBAN without the name the account is held in', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying half a bank account.',
      body: await form({ bank: { ...BANK, accountHolder: '' } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'account_holder_required' });
  });

  it('refuses a holder name longer than the column holds, rather than cutting it', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying a value the column would refuse.',
      body: await form({ bank: { ...BANK, accountHolder: 'A'.repeat(121) } }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'account_holder_invalid' });
  });

  it('holds the same rules in the database, beneath the route', async () => {
    await expect(owner.query("update tenant set bank_iban = 'AE07 0000'")).rejects.toThrow(
      /tenant_bank_iban_shape/,
    );
    await expect(
      owner.query("update tenant set bank_iban = null, bank_bic = 'TESTAEXX'"),
    ).rejects.toThrow(/tenant_bank/);
  });

  it('writes the reason onto the audit row, with the account unredacted', async () => {
    const reason = 'The practice changed bank.';
    const res = await call('PATCH', authIdOf(0), {
      reason,
      body: await form({ bank: { ...BANK, bic: null, bankAddress: null } }),
    });
    expect(res.status).toBe(200);
    const { rows } = await owner.query<{
      reason: string | null;
      changed_fields: string[];
      new_values: Record<string, unknown>;
    }>(
      'select reason, changed_fields, new_values from audit_log ' +
        "where entity_type = 'tenant' and action = 'update' order by id desc limit 1",
    );
    expect(rows[0]?.reason).toBe(reason);
    expect(rows[0]?.changed_fields).toEqual(expect.arrayContaining(['bank_address', 'bank_bic']));
    expect(rows[0]?.new_values).toMatchObject({ bank_iban: 'AE360000000000000000001' });
  });

  it('clears the bank account when every field is null', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'The practice no longer takes bank transfers.',
      body: await form({
        bank: { accountHolder: null, iban: null, bic: null, bankAddress: null },
      }),
    });
    expect(res.status).toBe(200);
    expect((await read(authIdOf(0))).bank).toBeNull();
  });
});

/**
 * A contact field sent as null (or blank, which the drawer sends for an empty
 * box) is cleared; one the body never mentions is left alone. Until round 61
 * a null was read as "not sent" and the old value kept.
 */
describe('clearing the practice’s contact details', () => {
  it('clears a contact field when it is sent as null', async () => {
    await call('PATCH', authIdOf(0), {
      reason: "Putting the practice's own details on its documents.",
      body: await form({
        contactPhone: '+971 50 000 0012',
        contactEmail: 'office@example.com',
        website: 'https://example.com',
      }),
    });
    expect((await read(authIdOf(0))).contactPhone).toBe('+971 50 000 0012');

    const res = await call('PATCH', authIdOf(0), {
      reason: 'The practice gave up its landline.',
      body: await form({ contactPhone: null }),
    });
    expect(res.status).toBe(200);
    expect(await read(authIdOf(0))).toMatchObject({
      contactPhone: null,
      contactEmail: 'office@example.com',
      website: 'https://example.com',
    });

    // Blank is the drawer's way of saying the same thing.
    await call('PATCH', authIdOf(0), {
      reason: 'Taking the email and website off the documents.',
      body: await form({ contactEmail: '', website: null }),
    });
    expect(await read(authIdOf(0))).toMatchObject({ contactEmail: null, website: null });
  });
});

/**
 * `tenant.review_url` (migration 920): the page the portal's review line
 * opens. Unlike the three footer fields above it, a save that carries it as
 * null clears it, because clearing the link is how the review line is
 * switched off for every household; a save that never mentions it leaves it
 * alone, as the three are.
 */
describe('the practice’s review link', () => {
  it('is absent until somebody records it, and switches nothing on', async () => {
    expect((await read(authIdOf(0))).reviewUrl).toBeNull();
  });

  it('is saved, left alone by a save that omits it, and cleared by one that sends null', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Asking households for a review after a brain map.',
      body: await form({ reviewUrl: 'https://example.com/review' }),
    });
    expect(res.status).toBe(200);
    expect((await read(authIdOf(0))).reviewUrl).toBe('https://example.com/review');

    await call('PATCH', authIdOf(0), {
      reason: 'An ordinary save that never mentions the link.',
      body: await form({ legalNameAr: 'استوديو العافية التجريبي' }),
    });
    expect((await read(authIdOf(0))).reviewUrl).toBe('https://example.com/review');

    const cleared = await call('PATCH', authIdOf(0), {
      reason: 'Switching the review line off.',
      body: await form({ reviewUrl: null }),
    });
    expect(cleared.status).toBe(200);
    expect((await read(authIdOf(0))).reviewUrl).toBeNull();
  });

  it('refuses a link with no scheme', async () => {
    const res = await call('PATCH', authIdOf(0), {
      reason: 'Trying a value the column would refuse.',
      body: await form({ reviewUrl: 'g.page/synthetic-studio' }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * `tenant.record_readings` (migration 918): whether a visit asks the
 * practitioner to enter signal, artefact and reward figures, off by default
 * because the practice now takes its readings on its own software instead
 * (docs/SPEC/session-capture.md section 3.3's amendment). The read side is
 * covered against a real database already (the seed ships it false, and
 * `app/therapist/session/steps.ts` is exercised against both values); this is
 * the write side — the coalesce that turns it back on — round-tripped the
 * same way `contactPhone` is above.
 */
describe('tenant.record_readings', () => {
  it('starts false, and a save carrying it true turns the switch on', async () => {
    expect((await read(authIdOf(0))).recordReadings).toBe(false);

    const res = await call('PATCH', authIdOf(0), {
      reason: 'The practice is bringing its own readings back into the app.',
      body: await form({ recordReadings: true }),
    });
    expect(res.status).toBe(200);
    const saved = ((await res.json()) as PracticeResponse).practice;
    expect(saved.recordReadings).toBe(true);
    // Read back through a second request, not from the answer to the first.
    expect((await read(authIdOf(0))).recordReadings).toBe(true);

    // And a save that never mentions it leaves the switch exactly as it
    // stands, as a save that omits a contact field leaves that field.
    await call('PATCH', authIdOf(0), {
      reason: 'An ordinary save from the settings screen.',
      body: await form({ legalNameAr: 'استوديو العافية' }),
    });
    expect((await read(authIdOf(0))).recordReadings).toBe(true);
  });
});
