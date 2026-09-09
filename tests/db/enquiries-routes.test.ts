import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';

/**
 * What a person does with an enquiry, through the API the server actually
 * builds: the list is read and logged, a conversion creates an audited lead
 * and scrubs the row, a dismissal scrubs the row, and the wrong role is
 * refused at the door and by the rows.
 */

const LODGE = 'select app.lodge_enquiry($1::jsonb) as id';

function lodging(name: string, hash: string): string {
  return JSON.stringify({
    source: 'website',
    name,
    whatsapp_e164: '+971500000099',
    email: 'hazel@example.com',
    message: 'I want to know more',
    consent: 'true',
    ip_hash: hash,
  });
}

let h: PortalHarness;

beforeAll(async () => {
  h = await startPortalHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

async function lodge(name: string, hash = 'c'.repeat(64)): Promise<string> {
  const { rows } = await h.owner.query<{ id: string }>(LODGE, [lodging(name, hash)]);
  return rows[0]!.id;
}

describe('the enquiries a person sees', () => {
  it('lists them for an admin, new first, and logs the read of each one still carrying a person', async () => {
    await h.owner.query('delete from enquiry');
    const first = await lodge('Hazel Harbour', 'c'.repeat(64));
    const second = await lodge('Rowan Meadow', 'd'.repeat(64));
    const res = await h.callAs('GET', '/api/enquiries', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      enquiries: { id: string; name: string; status: string }[];
    };
    expect(body.enquiries.map((e) => e.id)).toEqual([second, first]);
    expect(body.enquiries[0]).toMatchObject({ name: 'Rowan Meadow', status: 'new' });
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'enquiry' and action = 'list' and actor_id = $1",
      [PORTAL.admin],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(2);
  });

  it('lists them for the lead practitioner, and refuses a practitioner', async () => {
    expect((await h.callAs('GET', '/api/enquiries', PORTAL.leadAuth)).status).toBe(200);
    expect((await h.callAs('GET', '/api/enquiries', PORTAL.practitionerAuth)).status).toBe(403);
  });
});

describe('actioning', () => {
  it('converts an enquiry into an audited lead, and keeps nothing personal on the row', async () => {
    await h.owner.query('delete from enquiry');
    const id = await lodge('Hazel Fern Harbour');
    const res = await h.callAs('POST', `/api/enquiries/${id}/convert`, PORTAL.adminAuth);
    expect(res.status).toBe(201);
    const { clientId, mrn } = (await res.json()) as { clientId: string; mrn: string };
    expect(mrn).toMatch(/^MW-/);

    const client = await h.owner.query(
      'select given_name, family_name, status, referral_source from client where id = $1',
      [clientId],
    );
    expect(client.rows[0]).toEqual({
      given_name: 'Hazel',
      family_name: 'Fern Harbour',
      status: 'lead',
      referral_source: 'website',
    });
    const contact = await h.owner.query(
      'select relationship, phone, email, can_consent from contact where client_id = $1',
      [clientId],
    );
    expect(contact.rows).toEqual([
      {
        relationship: 'self',
        phone: '+971500000099',
        email: 'hazel@example.com',
        can_consent: false,
      },
    ]);

    const enquiry = await h.owner.query(
      'select status, client_id, name, whatsapp_e164, email, message, consent, ip_hash, actioned_by from enquiry where id = $1',
      [id],
    );
    expect(enquiry.rows[0]).toEqual({
      status: 'converted',
      client_id: clientId,
      name: null,
      whatsapp_e164: null,
      email: null,
      message: null,
      consent: null,
      ip_hash: null,
      actioned_by: PORTAL.admin,
    });

    // The enquiry's own trail: its personal fields were read once for the
    // conversion, and the conversion itself is in the chain, both under the
    // person who pressed the button.
    const own = await h.owner.query<{ action: string; client_id: string | null }>(
      "select action, client_id from audit_log where entity_type = 'enquiry' and entity_id = $1 and actor_id = $2 order by action",
      [id, PORTAL.admin],
    );
    expect(own.rows).toEqual([
      { action: 'convert', client_id: clientId },
      { action: 'read', client_id: null },
    ]);

    // Option B: the client is audited from its first byte, under the person who pressed the button.
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'client' and entity_id = $1 and actor_id = $2",
      [clientId, PORTAL.admin],
    );
    expect(Number(trail.rows[0]?.n)).toBeGreaterThanOrEqual(1);

    // And not twice.
    expect((await h.callAs('POST', `/api/enquiries/${id}/convert`, PORTAL.adminAuth)).status).toBe(
      404,
    );
  });

  it('dismisses with a reason and scrubs, and refuses a dismissal without one', async () => {
    await h.owner.query('delete from enquiry');
    const id = await lodge('Basil Valley');
    expect(
      (await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, {})).status,
    ).toBe(400);
    // A reason that carries a number would put a person back on a scrubbed row.
    expect(
      (
        await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, {
          reason: 'Rang +971 50 000 0098, not now',
        })
      ).status,
    ).toBe(400);
    const res = await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.leadAuth, {
      reason: 'Not a client enquiry',
    });
    expect(res.status).toBe(200);
    const { rows } = await h.owner.query(
      'select status, dismiss_reason, name, actioned_by from enquiry where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({
      status: 'dismissed',
      dismiss_reason: 'Not a client enquiry',
      name: null,
      actioned_by: PORTAL.leadPractitioner,
    });
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'enquiry' and entity_id = $1 and action = 'dismiss' and actor_id = $2",
      [id, PORTAL.leadPractitioner],
    );
    expect(trail.rows[0]?.n).toBe('1');
  });

  it('refuses a practitioner the action, and answers not found for a stranger’s id', async () => {
    await h.owner.query('delete from enquiry');
    const id = await lodge('Iris Creek');
    expect(
      (await h.callAs('POST', `/api/enquiries/${id}/convert`, PORTAL.practitionerAuth)).status,
    ).toBe(403);
    expect(
      (
        await h.callAs(
          'POST',
          '/api/enquiries/00000000-0000-4000-8000-0000000000ff/dismiss',
          PORTAL.adminAuth,
          { reason: 'x' },
        )
      ).status,
    ).toBe(404);
    // An id that is not one at all is the same answer, not a database error.
    expect(
      (await h.callAs('POST', '/api/enquiries/not-an-id/convert', PORTAL.adminAuth)).status,
    ).toBe(404);
  });
});
