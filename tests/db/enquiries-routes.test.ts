import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';
import { IDS } from './helpers';

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

/** The expo form's lodging: the two answers, and the stand's own address. */
function expoLodging(name: string, hash = 'e'.repeat(64)): string {
  return JSON.stringify({
    source: 'expo',
    name,
    whatsapp_e164: '+971500000098',
    area: 'Mirdif',
    message: 'Saw the stand, would like a home visit',
    enquiring_for: 'child',
    interest: 'both',
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
  it('lists them for an admin, newest first, and logs the read of each one still carrying a person', async () => {
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

  it('lists the two answers for an expo enquiry', async () => {
    await h.owner.query('delete from enquiry');
    const { rows } = await h.owner.query<{ id: string }>(LODGE, [expoLodging('Rowan Meadow')]);
    const res = await h.callAs('GET', '/api/enquiries', PORTAL.adminAuth);
    const body = (await res.json()) as { enquiries: Record<string, unknown>[] };
    expect(body.enquiries[0]).toMatchObject({
      id: rows[0]!.id,
      source: 'expo',
      enquiringFor: 'child',
      interest: 'both',
    });
  });
});

describe('one status at a time', () => {
  type Listed = {
    enquiries: { id: string; status: string; name: string | null; dismissReason: string | null }[];
    counts: Record<string, Record<string, number>>;
    older: string | null;
  };
  const list = async (query: string): Promise<Listed> => {
    const res = await h.callAs('GET', `/api/enquiries${query}`, PORTAL.adminAuth);
    expect(res.status).toBe(200);
    return (await res.json()) as Listed;
  };
  const dismissed = async (id: string, reason: string): Promise<void> => {
    const res = await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, {
      reason,
    });
    expect(res.status).toBe(200);
  };

  it('keeps what is waiting and what was dismissed in lists of their own, and counts both', async () => {
    await h.owner.query('delete from enquiry');
    const waiting = await lodge('Hazel Harbour', 'c'.repeat(64));
    const gone = await lodge('Rowan Meadow', 'd'.repeat(64));
    const { rows } = await h.owner.query<{ id: string }>(LODGE, [expoLodging('Iris Creek')]);
    const expo = rows[0]!.id;
    await dismissed(gone, 'Not a client enquiry');

    // Asked for nothing, a screen gets what is waiting: never a dismissed row.
    const active = await list('');
    expect(active.enquiries.map((e) => e.id)).toEqual([expo, waiting]);
    expect(active.enquiries.every((e) => e.status === 'new')).toBe(true);
    expect((await list('?status=new')).enquiries.map((e) => e.id)).toEqual([expo, waiting]);

    const out = await list('?status=dismissed');
    expect(out.enquiries).toHaveLength(1);
    expect(out.enquiries[0]).toMatchObject({
      id: gone,
      status: 'dismissed',
      name: null,
      dismissReason: 'Not a client enquiry',
    });
    expect((await list('?status=converted')).enquiries).toEqual([]);

    // The same counts whichever list was asked for: they are the tabs' labels.
    for (const listed of [active, out]) {
      expect(listed.counts.new).toEqual({ all: 2, website: 1, discovery_call: 0, expo: 1 });
      expect(listed.counts.dismissed).toEqual({ all: 1, website: 1, discovery_call: 0, expo: 0 });
      expect(listed.counts.converted).toEqual({ all: 0, website: 0, discovery_call: 0, expo: 0 });
    }

    expect((await list('?status=new&source=expo')).enquiries.map((e) => e.id)).toEqual([expo]);
    expect((await list('?status=dismissed&source=expo')).enquiries).toEqual([]);
  });

  it('logs no read for a page of dismissed rows, which carry nobody', async () => {
    await h.owner.query('delete from enquiry');
    await dismissed(await lodge('Basil Valley'), 'Wrong number');
    const reads = async (): Promise<number> => {
      const { rows } = await h.owner.query<{ n: string }>(
        "select count(*)::text as n from audit_log where entity_type = 'enquiry' and action = 'list'",
      );
      return Number(rows[0]?.n);
    };
    // The log is being read aright: a waiting row is one read, by this name.
    await lodge('Iris Creek', 'f'.repeat(64));
    const before = await reads();
    await list('?status=new');
    expect(await reads()).toBe(before + 1);
    // And a page of dismissed rows beside it is none.
    await list('?status=dismissed');
    expect(await reads()).toBe(before + 1);
  });

  it('refuses a status, a source or a cursor it does not know', async () => {
    // The last is a cursor in the right shape for a day that does not exist:
    // the database would refuse it, and the screen's user is owed a 400, not a 500.
    for (const query of [
      '?status=archived',
      '?source=billboard',
      '?before=yesterday',
      '?before=2026-02-30T00:00:00Z_0000000e-0000-4000-8000-000000000001',
    ]) {
      const res = await h.callAs('GET', `/api/enquiries${query}`, PORTAL.adminAuth);
      expect(res.status).toBe(400);
    }
  });

  it('pages through every row once and once only, when many were lodged in one instant', async () => {
    // The stand's code scanned by a queue: rows a microsecond apart, or not
    // apart at all. A cursor cut to the millisecond would step over some.
    await h.owner.query('delete from enquiry');
    await h.owner.query(
      `insert into enquiry (tenant_id, source, status, dismiss_reason, actioned_at, actioned_by, received_at)
       select $1, 'expo', 'dismissed', 'Stand test', now(), $2,
              timestamptz '2026-10-14 11:20:05.123+00' + (n % 7) * interval '100 microseconds'
       from generate_series(1, 230) as n`,
      [IDS.tenantA, PORTAL.admin],
    );
    const seen: string[] = [];
    let query = '?status=dismissed';
    for (let page = 0; page < 5; page += 1) {
      const listed = await list(query);
      seen.push(...listed.enquiries.map((e) => e.id));
      expect(listed.counts.dismissed?.all).toBe(230);
      if (listed.older === null) break;
      expect(listed.enquiries).toHaveLength(100);
      query = `?status=dismissed&before=${encodeURIComponent(listed.older)}`;
    }
    expect(seen).toHaveLength(230);
    expect(new Set(seen).size).toBe(230);
  });
});

/**
 * The operator's decision of 19 September 2026: a dismissed enquiry keeps its
 * person where that person was told it would
 * (docs/superpowers/plans/2026-09-19-enquiries-keep-details.md).
 */
describe('what a dismissal keeps', () => {
  /** Lodged under the second wording: "we keep them so we can follow up with you later". */
  const told = async (name: string, hash: string, marketing: boolean): Promise<string> => {
    const { rows } = await h.owner.query<{ id: string }>(LODGE, [
      JSON.stringify({
        source: 'expo',
        name,
        whatsapp_e164: '+971500000097',
        email: 'rowan@example.com',
        area: 'Mirdif',
        message: 'Saw the stand',
        enquiring_for: 'self',
        interest: 'both',
        consent: 'true',
        notice_version: '2',
        marketing_opt_in: marketing ? 'true' : 'false',
        ip_hash: hash,
      }),
    ]);
    return rows[0]!.id;
  };
  const rowOf = async (id: string) =>
    (
      await h.owner.query<Record<string, unknown>>(
        'select status, name, whatsapp_e164, email, marketing_opt_in, ip_hash, message, dismiss_reason from enquiry where id = $1',
        [id],
      )
    ).rows[0];
  const reads = async (id: string): Promise<number> => {
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'enquiry' and action = 'list' and entity_id = $1",
      [id],
    );
    return Number(rows[0]?.n);
  };

  it('keeps a person who was told they would be, shows them, and logs each time they are read', async () => {
    await h.owner.query('delete from enquiry');
    const id = await told('Rowan Meadow', 'a'.repeat(64), true);
    const res = await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, {
      reason: 'Not now, maybe after the summer',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, kept: true });
    expect(await rowOf(id)).toEqual({
      status: 'dismissed',
      name: 'Rowan Meadow',
      whatsapp_e164: '+971500000097',
      email: 'rowan@example.com',
      marketing_opt_in: true,
      // The address hash has no follow-up purpose and goes either way.
      ip_hash: null,
      // How to reach them is kept; what they wrote is not.
      message: null,
      dismiss_reason: 'Not now, maybe after the summer',
    });

    const before = await reads(id);
    const listed = await h.callAs('GET', '/api/enquiries?status=dismissed', PORTAL.adminAuth);
    const body = (await listed.json()) as { enquiries: Record<string, unknown>[] };
    expect(body.enquiries[0]).toMatchObject({
      id,
      name: 'Rowan Meadow',
      whatsappE164: '+971500000097',
      noticeVersion: 2,
      marketingOptIn: true,
    });
    // A dismissed row that names somebody is a read of somebody.
    expect(await reads(id)).toBe(before + 1);
  });

  it('erases at the moment of dismissing when asked to, and always for a person promised it', async () => {
    await h.owner.query('delete from enquiry');
    const spam = await told('Basil Valley', 'b'.repeat(64), false);
    const res = await h.callAs('POST', `/api/enquiries/${spam}/dismiss`, PORTAL.adminAuth, {
      reason: 'Wrong number',
      erase: true,
    });
    expect(await res.json()).toEqual({ ok: true, kept: false });
    expect(await rowOf(spam)).toMatchObject({
      status: 'dismissed',
      name: null,
      marketing_opt_in: null,
    });

    // Lodged under "keeps nothing personal": erased, whatever was or was not asked.
    const promised = await lodge('Hazel Harbour', 'c'.repeat(64));
    const kept = await h.callAs('POST', `/api/enquiries/${promised}/dismiss`, PORTAL.adminAuth, {
      reason: 'Not a client enquiry',
      erase: false,
    });
    expect(await kept.json()).toEqual({ ok: true, kept: false });
    expect(await rowOf(promised)).toMatchObject({ status: 'dismissed', name: null });
  });

  it('erases a kept person later, once, by those who may, and says so in the log', async () => {
    await h.owner.query('delete from enquiry');
    const id = await told('Iris Creek', 'd'.repeat(64), true);
    const waiting = await told('Rowan Meadow', 'e'.repeat(64), false);
    await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, { reason: 'Not now' });

    expect(
      (await h.callAs('POST', `/api/enquiries/${id}/erase`, PORTAL.practitionerAuth, {})).status,
    ).toBe(403);
    // Only a dismissed row is erased this way: a waiting one is converted or dismissed.
    expect(
      (await h.callAs('POST', `/api/enquiries/${waiting}/erase`, PORTAL.adminAuth, {})).status,
    ).toBe(404);

    const res = await h.callAs('POST', `/api/enquiries/${id}/erase`, PORTAL.leadAuth, {});
    expect(res.status).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      status: 'dismissed',
      name: null,
      whatsapp_e164: null,
      email: null,
      marketing_opt_in: null,
      dismiss_reason: 'Not now',
    });
    const trail = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'enquiry' and entity_id = $1 and action = 'erase' and actor_id = $2",
      [id, PORTAL.leadPractitioner],
    );
    expect(trail.rows[0]?.n).toBe('1');
    // Nobody left to erase.
    expect(
      (await h.callAs('POST', `/api/enquiries/${id}/erase`, PORTAL.adminAuth, {})).status,
    ).toBe(404);
  });

  it('lists for the practice’s news only people who asked, were dismissed, and are still on a row', async () => {
    await h.owner.query('delete from enquiry');
    // Ticked, and still waiting: nobody has spoken to them, so not yet.
    const waiting = await told('Rowan Meadow', 'a'.repeat(64), true);
    const dismissedKept = await told('Iris Creek', 'b'.repeat(64), true);
    const saidNo = await told('Basil Valley', 'c'.repeat(64), false);
    const erased = await told('Hazel Valley', 'd'.repeat(64), true);
    await lodge('Hazel Harbour', 'e'.repeat(64)); // never asked
    for (const [id, body] of [
      [dismissedKept, { reason: 'Later' }],
      [saidNo, { reason: 'Later' }],
      [erased, { reason: 'Asked us to', erase: true }],
    ] as const) {
      await h.callAs('POST', `/api/enquiries/${id}/dismiss`, PORTAL.adminAuth, body);
    }

    const counted = (await (await h.callAs('GET', '/api/enquiries', PORTAL.adminAuth)).json()) as {
      marketable: number;
    };
    expect(counted.marketable).toBe(1);

    expect(
      (await h.callAs('GET', '/api/enquiries/marketing.csv', PORTAL.practitionerAuth)).status,
    ).toBe(403);
    const before = await reads(dismissedKept);
    const waitingBefore = await reads(waiting);
    const res = await h.callAs('GET', '/api/enquiries/marketing.csv', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="news-list-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = (await res.text()).trim().split('\r\n');
    expect(lines[0]).toBe('Name,WhatsApp,Email,Area,From,Received,Dismissed');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Iris Creek');
    // The number on the button is the length of the file: one rule, asked twice.
    expect(lines.length - 1).toBe(counted.marketable);
    // Nothing anybody wrote travels in it.
    expect(lines.join('\n')).not.toContain('Saw the stand');
    // One person read, the one in the file; and the file itself logged once as an export.
    expect(await reads(dismissedKept)).toBe(before + 1);
    expect(await reads(waiting)).toBe(waitingBefore);
    const exported = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where entity_type = 'enquiry_export' and action = 'export' and new_values->>'list' = 'news'",
    );
    expect(exported.rows[0]?.n).toBe('1');
  });
});

describe('the expo leads file', () => {
  it('downloads the new expo enquiries as a file, logs the read of each row and the export once', async () => {
    await h.owner.query('delete from enquiry');
    const first = await h.owner.query<{ id: string }>(LODGE, [expoLodging('Rowan Meadow')]);
    const second = await h.owner.query<{ id: string }>(LODGE, [
      expoLodging('Basil Valley', 'f'.repeat(64)),
    ]);
    // A website enquiry and an actioned expo one are not in the file.
    await lodge('Hazel Harbour');
    const gone = await h.owner.query<{ id: string }>(LODGE, [
      expoLodging('Iris Creek', 'a'.repeat(64)),
    ]);
    expect(
      (
        await h.callAs('POST', `/api/enquiries/${gone.rows[0]!.id}/dismiss`, PORTAL.adminAuth, {
          reason: 'Asked us not to call',
        })
      ).status,
    ).toBe(200);

    const res = await h.callAs('GET', '/api/enquiries/expo.csv', PORTAL.adminAuth);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename="expo-leads-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const lines = (await res.text()).split('\r\n');
    expect(lines[0]).toBe(
      'Received,Name,WhatsApp,Email,Area,Enquiring for,Interest,Reason,Agreed to be contacted',
    );
    // Oldest first; the number guarded as text; the answers in words.
    expect(lines[1]).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2},Rowan Meadow,'\+971500000098,,Mirdif,A child,Both,"Saw the stand, would like a home visit",Yes$/,
    );
    expect(lines[2]).toContain('Basil Valley');
    expect(lines).toHaveLength(4);
    expect(lines[3]).toBe('');

    const reads = await h.owner.query<{ entity_id: string }>(
      "select entity_id from audit_log where entity_type = 'enquiry' and action = 'list' and actor_id = $1 " +
        'and request_id = (select request_id from audit_log where action = $2 order by id desc limit 1) order by entity_id',
      [PORTAL.admin, 'export'],
    );
    expect(reads.rows.map((r) => r.entity_id).sort()).toEqual(
      [first.rows[0]!.id, second.rows[0]!.id].sort(),
    );
    const exported = await h.owner.query<{ new_values: { source: string; rows: string } }>(
      "select new_values from audit_log where entity_type = 'enquiry_export' and action = 'export' and actor_id = $1 order by id desc limit 1",
      [PORTAL.admin],
    );
    expect(exported.rows[0]?.new_values).toEqual({ source: 'expo', rows: '2' });
  });

  it('refuses the file to a practitioner', async () => {
    expect((await h.callAs('GET', '/api/enquiries/expo.csv', PORTAL.practitionerAuth)).status).toBe(
      403,
    );
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

  it('converts an expo enquiry into a lead that says it came from the expo', async () => {
    await h.owner.query('delete from enquiry');
    const { rows } = await h.owner.query<{ id: string }>(LODGE, [expoLodging('Rowan Meadow')]);
    const id = rows[0]!.id;
    const res = await h.callAs('POST', `/api/enquiries/${id}/convert`, PORTAL.adminAuth);
    expect(res.status).toBe(201);
    const { clientId } = (await res.json()) as { clientId: string };
    const client = await h.owner.query('select referral_source from client where id = $1', [
      clientId,
    ]);
    expect(client.rows[0]).toEqual({ referral_source: 'expo' });
    const enquiry = await h.owner.query(
      'select status, enquiring_for, interest from enquiry where id = $1',
      [id],
    );
    expect(enquiry.rows[0]).toEqual({ status: 'converted', enquiring_for: null, interest: null });
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
