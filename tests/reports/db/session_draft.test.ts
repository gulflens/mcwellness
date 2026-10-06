import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DraftResponse } from '../../../app/api/reports/schema';
import { SEEDED, startHarness, type Harness } from './support';

/**
 * `POST /api/reports/session-draft` — the session report for one visit, from
 * the end of the visit itself. The practice asked whether what is done on
 * Today reaches the client's Reports; it did not, because a report was only
 * ever started from the record. This door starts one from the visit, and is
 * idempotent on the visit: asked twice, it opens the report already there
 * rather than writing a second.
 *
 * Everything is invented: the seed's people, visits on made-up days.
 */

const NOW = () => new Date('2026-09-06T08:00:00.000Z');

let h: Harness;

beforeAll(async () => {
  h = await startHarness(NOW);
}, 120_000);

afterAll(async () => {
  await h.close();
});

async function sessionReportsFor(sessionId: string): Promise<number> {
  const { rows } = await h.owner.query<{ n: string }>(
    "select count(*)::text as n from report where kind = 'session' " +
      "and content->>'sessionId' = $1",
    [sessionId],
  );
  return Number(rows[0]?.n);
}

describe('starting the session report from the visit', () => {
  it('drafts it from the visit alone, the client resolved by the server', async () => {
    const visit = await h.completedVisit(4);
    const res = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: visit,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as DraftResponse;
    expect(body.report.kind).toBe('session');
    expect(body.report.status).toBe('draft');
    expect(body.report.clientId).toBe(h.clientId(4));
    const content = body.content as { sessionId: string; note: string; serviceName: string };
    expect(content.sessionId).toBe(visit);
    // The figures are the visit's; the words are still to be written.
    expect(content.serviceName).toBeTruthy();
    expect(content.note).toBe('');
  });

  it('opens the one already there rather than writing a second', async () => {
    const visit = await h.completedVisit(5);
    const first = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: visit,
    });
    expect(first.status).toBe(201);
    const second = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: visit,
    });
    expect(second.status).toBe(200);
    const a = (await first.json()) as DraftResponse;
    const b = (await second.json()) as DraftResponse;
    expect(b.report.id).toBe(a.report.id);
    expect(await sessionReportsFor(visit)).toBe(1);
  });

  it('writes one draft when the button is pressed twice at once', async () => {
    // Two presses at once — a double click, or the practitioner on her phone
    // and the owner at the desk. Each must hold the visit while it looks for
    // a draft and writes one, or both look, both find nothing and both write.
    // Today the trail's own chain happens to queue the two requests, so the
    // race cannot be produced from outside; what is proved is that the door
    // takes the visit's lock and waits on it, which is what holds whatever
    // else changes.
    await h.onSchedule(11, SEEDED.practitioner);
    const visit = await h.completedVisit(11, SEEDED.practitioner);
    await h.owner.query('begin');
    await h.owner.query("select pg_advisory_xact_lock(hashtext('session-draft:' || $1::text))", [
      visit,
    ]);
    const presses = [SEEDED.owner, SEEDED.practitioner].map((user) =>
      h.call('POST', '/api/reports/session-draft', user, { sessionId: visit }),
    );
    try {
      const deadline = Date.now() + 4_000;
      for (;;) {
        // The activity view is read once per transaction unless cleared.
        await h.owner.query('select pg_stat_clear_snapshot()');
        const { rows } = await h.owner.query<{ n: number }>(
          'select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid ' +
            "where a.application_name = 'mcwellness-api' and l.locktype = 'advisory' " +
            'and not l.granted',
        );
        if ((rows[0]?.n ?? 0) >= 1) break;
        if (Date.now() > deadline) throw new Error('No press waited on the visit.');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      await h.owner.query('rollback');
    }
    const answers = await Promise.all(presses);
    expect(answers.map((res) => res.status).sort()).toEqual([200, 201]);
    const ids = await Promise.all(
      answers.map(async (res) => ((await res.json()) as DraftResponse).report.id),
    );
    expect(ids[0]).toBe(ids[1]);
    expect(await sessionReportsFor(visit)).toBe(1);
  });

  it('opens a signed one too, rather than starting the visit over', async () => {
    const visit = await h.completedVisit(6);
    const drafted = (await (
      await h.call('POST', '/api/reports/session-draft', SEEDED.owner, { sessionId: visit })
    ).json()) as DraftResponse;
    const issued = await h.call(
      'POST',
      `/api/reports/${drafted.report.id}/issue`,
      SEEDED.owner,
      {},
    );
    expect(issued.status).toBe(201);
    const again = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: visit,
    });
    expect(again.status).toBe(200);
    const body = (await again.json()) as DraftResponse;
    expect(body.report.id).toBe(drafted.report.id);
    expect(body.report.status).toBe('issued');
    expect(await sessionReportsFor(visit)).toBe(1);
  });

  it('lets the practitioner who made the visit start it', async () => {
    await h.onSchedule(7, SEEDED.practitioner);
    const visit = await h.completedVisit(7, SEEDED.practitioner);
    const res = await h.call('POST', '/api/reports/session-draft', SEEDED.practitioner, {
      sessionId: visit,
    });
    expect(res.status).toBe(201);
  });

  it('refuses an administrator, who reads reports and never drafts them', async () => {
    const visit = await h.completedVisit(8);
    const res = await h.call('POST', '/api/reports/session-draft', SEEDED.admin, {
      sessionId: visit,
    });
    expect(res.status).toBe(403);
    expect(await sessionReportsFor(visit)).toBe(0);
  });

  it('answers not found for a visit that is not there, and a malformed request plainly', async () => {
    const missing = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: '00000003-0000-4000-8000-0000000000ff',
    });
    expect(missing.status).toBe(404);
    expect((await missing.json()) as { code: string }).toMatchObject({ code: 'no_such_visit' });
    const bad = await h.call('POST', '/api/reports/session-draft', SEEDED.owner, {
      sessionId: 'not-an-id',
    });
    expect(bad.status).toBe(400);
  });

  it('writes the read of the visit to the trail before it answers', async () => {
    const visit = await h.completedVisit(9);
    await h.call('POST', '/api/reports/session-draft', SEEDED.owner, { sessionId: visit });
    const { rows } = await h.owner.query<{ n: string }>(
      "select count(*)::text as n from audit_log where action = 'read' " +
        "and entity_type = 'client' and client_id = $1",
      [h.clientId(9)],
    );
    expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });
});
