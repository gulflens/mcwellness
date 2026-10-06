import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PORTAL, startPortalHarness, type PortalHarness } from '../portal/db/support';

/**
 * What the office does with a website review, through the API the server
 * actually builds (app/api/testimonials/routes.ts, docs/SPEC/testimonials.md
 * section 5): the list is read and logged, each decision is logged under the
 * person who made it, the order the office sets is the order the website
 * reads, and the roles that may not decide are refused.
 */

const SUBMIT = 'select app.submit_testimonial($1::jsonb) as id';

let h: PortalHarness;
let hashes = 0;

beforeAll(async () => {
  h = await startPortalHarness();
}, 120_000);

afterAll(async () => {
  await h.close();
});

/** A review as the door files it, each from an address of its own. */
async function submit(displayName: string, language: 'en' | 'ar' = 'en'): Promise<string> {
  hashes += 1;
  const { rows } = await h.owner.query<{ id: string }>(SUBMIT, [
    JSON.stringify({
      display_name: displayName,
      rating: 5,
      body: 'Kind, punctual and clear about every step.',
      language,
      consent_to_publish: true,
      ip_hash: hashes.toString(16).padStart(64, '0'),
    }),
  ]);
  return rows[0]!.id;
}

type Listed = {
  testimonials: { id: string; displayName: string; status: string; decidedByName: string | null }[];
  counts: { pending: number; approved: number; declined: number };
};

async function list(status: string): Promise<Listed> {
  const res = await h.callAs('GET', `/api/testimonials?status=${status}`, PORTAL.adminAuth);
  expect(res.status).toBe(200);
  return (await res.json()) as Listed;
}

async function act(id: string, action: string, body?: unknown): Promise<Response> {
  return h.callAs('POST', `/api/testimonials/${id}/${action}`, PORTAL.adminAuth, body);
}

async function published(): Promise<string[]> {
  const res = await h.api.request('/api/testimonials/published?lang=en');
  const body = (await res.json()) as { testimonials: { display_name: string }[] };
  return body.testimonials.map((t) => t.display_name);
}

describe('the reviews the office sees', () => {
  it('lists what is waiting for an admin, newest first, and logs the read of each', async () => {
    await h.owner.query('delete from testimonial');
    const first = await submit('Hazel H.');
    const second = await submit('Rowan M.');
    const listed = await list('pending');
    expect(listed.testimonials.map((t) => t.id)).toEqual([second, first]);
    expect(listed.counts).toEqual({ pending: 2, approved: 0, declined: 0 });
    const { rows } = await h.owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where entity_type = 'testimonial' and action = 'list' and actor_id = $1",
      [PORTAL.admin],
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(2);
  });

  it('counts what is waiting without logging a read', async () => {
    const before = await h.owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where entity_type = 'testimonial'",
    );
    const res = await h.callAs('GET', '/api/testimonials/count', PORTAL.adminAuth);
    expect(await res.json()).toEqual({ pending: 2 });
    const after = await h.owner.query<{ n: number }>(
      "select count(*)::int as n from audit_log where entity_type = 'testimonial'",
    );
    expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  });

  it('refuses the lead practitioner, a practitioner and finance, at the route', async () => {
    for (const auth of [PORTAL.leadAuth, PORTAL.practitionerAuth, PORTAL.financeAuth]) {
      expect((await h.callAs('GET', '/api/testimonials', auth)).status).toBe(403);
      expect((await h.callAs('GET', '/api/testimonials/count', auth)).status).toBe(403);
    }
    const id = await submit('Iris C.');
    const res = await h.callAs('POST', `/api/testimonials/${id}/approve`, PORTAL.leadAuth, {});
    expect(res.status).toBe(403);
  });

  it('refuses a status it does not know', async () => {
    const res = await h.callAs('GET', '/api/testimonials?status=hidden', PORTAL.adminAuth);
    expect(res.status).toBe(400);
  });
});

describe('deciding', () => {
  it('approves onto the website, declines off it, and logs each under the admin', async () => {
    await h.owner.query('delete from testimonial');
    const kept = await submit('Hazel H.');
    const refused = await submit('Rowan M.');
    expect((await act(kept, 'approve')).status).toBe(200);
    expect((await act(refused, 'decline')).status).toBe(200);
    // Already decided: one answer for every row that is not waiting.
    expect((await act(kept, 'approve')).status).toBe(404);
    expect((await act(refused, 'approve')).status).toBe(404);

    expect(await published()).toEqual(['Hazel H.']);
    const approved = await list('approved');
    expect(approved.testimonials[0]).toMatchObject({
      id: kept,
      status: 'approved',
      decidedByName: 'Iris Harbour',
    });
    expect(approved.counts).toEqual({ pending: 0, approved: 1, declined: 1 });

    const { rows } = await h.owner.query<{ action: string; entity_id: string }>(
      "select action, entity_id from audit_log where entity_type = 'testimonial' " +
        "and action in ('approve', 'decline') and actor_id = $1 order by occurred_at",
      [PORTAL.admin],
    );
    expect(rows).toEqual([
      { action: 'approve', entity_id: kept },
      { action: 'decline', entity_id: refused },
    ]);
  });

  it('withdraws a published review: off the website at once, and declined from now', async () => {
    await h.owner.query('delete from testimonial');
    const id = await submit('Hazel H.');
    await act(id, 'approve');
    expect(await published()).toEqual(['Hazel H.']);
    expect((await act(id, 'withdraw')).status).toBe(200);
    expect(await published()).toEqual([]);
    expect((await list('declined')).testimonials.map((t) => t.id)).toEqual([id]);
    // A waiting or declined review has nothing to withdraw.
    expect((await act(id, 'withdraw')).status).toBe(404);
    const waiting = await submit('Rowan M.');
    expect((await act(waiting, 'withdraw')).status).toBe(404);
  });

  it('answers not found for an id that is not a review', async () => {
    expect((await act('not-an-id', 'approve')).status).toBe(404);
    expect((await act('00000001-0000-4000-8000-0000000009ff', 'approve')).status).toBe(404);
  });
});

describe('arranging the page', () => {
  it('moves a review up or down among its own language, and the website reads that order', async () => {
    await h.owner.query('delete from testimonial');
    const a = await submit('Basil V.');
    const b = await submit('Iris C.');
    const c = await submit('Rowan M.');
    const arabic = await submit('ريحان و.', 'ar');
    for (const id of [a, b, c, arabic]) await act(id, 'approve');
    // Unarranged: newest decision first.
    expect(await published()).toEqual(['Rowan M.', 'Iris C.', 'Basil V.']);

    expect(await (await act(a, 'move', { direction: 'up' })).json()).toEqual({
      ok: true,
      moved: true,
    });
    expect(await published()).toEqual(['Rowan M.', 'Basil V.', 'Iris C.']);
    await act(c, 'move', { direction: 'down' });
    expect(await published()).toEqual(['Basil V.', 'Rowan M.', 'Iris C.']);
    // At the top already: nothing to do.
    expect(await (await act(a, 'move', { direction: 'up' })).json()).toEqual({
      ok: true,
      moved: false,
    });
    // The console's Approved table reads in the same order, English first.
    expect((await list('approved')).testimonials.map((t) => t.displayName)).toEqual([
      'Basil V.',
      'Rowan M.',
      'Iris C.',
      'ريحان و.',
    ]);
    // A review approved since the arranging shows above the arranged ones.
    const late = await submit('Pearl C.');
    await act(late, 'approve');
    expect(await published()).toEqual(['Pearl C.', 'Basil V.', 'Rowan M.', 'Iris C.']);
  });

  it('refuses a direction it does not know, and a review that is not published', async () => {
    const waiting = await submit('Hazel H.');
    expect((await act(waiting, 'move', { direction: 'up' })).status).toBe(404);
    expect((await act(waiting, 'move', { direction: 'sideways' })).status).toBe(400);
  });
});
