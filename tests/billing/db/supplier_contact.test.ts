import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceDocument } from '../../../app/api/billing/document-source';
import { extractAll, renderDocument } from '../../../domain/billing/document';
import { documentFonts } from '../../../app/api/billing/fonts';
import { SEED_TODAY } from '../../../db/seed/generate';
import { SEEDED, setPracticePrices, startHarness, type Harness } from './support';

/**
 * The practice's contact details, from the row it types them on to the footer
 * of the document it hands a family (migrations 912 and 959,
 * docs/SPEC/billing.md section 5.6).
 *
 * The rule under test is the snapshot's own: an invoice copies what the
 * practice said **at numbering time** and never reads the live row again, so
 * changing the telephone number does not rewrite a document already issued.
 * Everything else on the supplier block has worked this way since 402 and 905;
 * these three join it.
 *
 * Synthetic throughout: the number is in the reserved fake range
 * (.claude/rules/testing.md) and the address and the site are at example.com.
 */

const NOW = () => new Date('2026-09-02T08:00:00.000Z');

const PHONE = '+971 50 000 0011';
const EMAIL = 'studio@example.com';
const WEBSITE = 'https://example.com';

let h: Harness;
let sessionSeq = 0;

async function asPractitioner(): Promise<void> {
  const user = h.data.users[SEEDED.practitioner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'practitioner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, '00000000-0000-4000-8000-0000000000fc'],
  );
}

/** A visit delivered, which is what numbers an invoice (404) and so stamps a supplier. */
async function deliverVisit(clientId: string): Promise<string> {
  sessionSeq += 1;
  const id = `00000000-0000-4000-8000-00000000d${String(sessionSeq).padStart(3, '0')}`;
  const practitioner = h.data.practitioners[0];
  await asPractitioner();
  await h.owner.query(
    'insert into session (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      "delivery_mode, status, checked_in_at) values ($1, $2, $3, $4, $5, 'home', 'completed', now())",
    [id, h.data.tenant.id, clientId, practitioner?.id, h.serviceTypeId('nf-session')],
  );
  const { rows } = await h.owner.query<{ id: string }>(
    'select id from invoice where session_id = $1',
    [id],
  );
  const invoiceId = rows[0]?.id;
  if (!invoiceId) throw new Error('That visit was not invoiced.');
  return invoiceId;
}

/** The database as the owner, whose details these are to change (905's guard). */
async function asOwner(): Promise<void> {
  const user = h.data.users[SEEDED.owner];
  await h.owner.query(
    "select set_config('app.tenant_id', $1, false), set_config('app.actor_id', $2, false), " +
      "set_config('app.actor_roles', 'owner', false), " +
      "set_config('app.request_id', $3, false), set_config('app.reason', '', false)",
    [h.data.tenant.id, user?.id ?? null, '00000000-0000-4000-8000-0000000000fd'],
  );
}

/** The practice records — or forgets — its own contact details. */
async function setContact(
  phone: string | null,
  email: string | null,
  website: string | null,
): Promise<void> {
  await asOwner();
  await h.owner.query(
    'update tenant set contact_phone = $2, contact_email = $3, website = $4 where id = $1',
    [h.data.tenant.id, phone, email, website],
  );
}

beforeAll(async () => {
  h = await startHarness(NOW);
  await setPracticePrices(h, SEED_TODAY);
}, 120_000);

afterAll(async () => {
  await h.close();
});

describe('the three columns the footer is set from', () => {
  it('refuses a value that is plainly in the wrong field', async () => {
    // Light checks, on purpose: they catch an address typed into the website
    // and a sentence typed into the telephone, and they decide nothing about
    // what a reachable site or a deliverable address is.
    await expect(setContact('ring the studio', null, null)).rejects.toThrow(/contact_phone/);
    await expect(setContact(null, 'not an address', null)).rejects.toThrow(/contact_email/);
    await expect(setContact(null, null, 'example.com')).rejects.toThrow(/website/);
  });
});

describe('an invoice numbered while the practice had contact details', () => {
  it('stamps all three onto the row and reads them back onto the document', async () => {
    await setContact(PHONE, EMAIL, WEBSITE);
    const invoiceId = await deliverVisit(h.clientId(0));

    const { rows } = await h.owner.query<{
      supplier_contact_phone: string | null;
      supplier_contact_email: string | null;
      supplier_website: string | null;
    }>(
      'select supplier_contact_phone, supplier_contact_email, supplier_website ' +
        'from invoice where id = $1',
      [invoiceId],
    );
    expect(rows[0]).toEqual({
      supplier_contact_phone: PHONE,
      supplier_contact_email: EMAIL,
      supplier_website: WEBSITE,
    });

    const found = await invoiceDocument(h.owner, invoiceId);
    if (!found) throw new Error('That invoice could not be read as a document.');
    expect(found.document.supplier.contactPhone).toBe(PHONE);
    expect(found.document.supplier.contactEmail).toBe(EMAIL);
    expect(found.document.supplier.website).toBe(WEBSITE);
  });

  it('keeps saying what it said after the practice changes its number', async () => {
    await setContact(PHONE, EMAIL, WEBSITE);
    const invoiceId = await deliverVisit(h.clientId(0));

    await setContact('+971 50 000 0099', 'moved@example.com', 'https://moved.example.com');

    const found = await invoiceDocument(h.owner, invoiceId);
    // The whole reason the snapshot exists: a document already handed to a
    // family does not change because the practice did.
    expect(found?.document.supplier.contactPhone).toBe(PHONE);
    expect(found?.document.supplier.website).toBe(WEBSITE);
  });
});

describe('an invoice numbered while the practice had none', () => {
  it('stamps nulls, and the document still renders with a footer', async () => {
    await setContact(null, null, null);
    const invoiceId = await deliverVisit(h.clientId(1));

    const found = await invoiceDocument(h.owner, invoiceId);
    if (!found) throw new Error('That invoice could not be read as a document.');
    expect(found.document.supplier.contactPhone).toBeNull();
    expect(found.document.supplier.contactEmail).toBeNull();
    expect(found.document.supplier.website).toBeNull();

    const page = extractAll(renderDocument(found.document, documentFonts()));
    // The legal name is still under the rule at the foot of the page; the
    // second line is simply not there rather than being a row of empty labels.
    expect(page).toContain(found.document.supplier.legalName);
    expect(page).not.toContain('P: ');
    expect(page).not.toContain('W: ');
  });
});
