import type { Hono } from 'hono';
import { z } from 'zod';
import { isoDateIn } from '../../../domain/shared';
import { validateContent, type ProgressNarrative } from '../../../domain/reports';
import { logRead } from '../_middleware/audit';
import { cleanText } from '../_middleware/text';
import type { ApiEnv } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import {
  gatherForClient,
  gatherSession,
  listVisits,
  practiceTimeZone,
  type SessionNarrative,
} from './gather';
import { DraftInput, DraftResponse, GatherResponse, VisitsResponse } from './schema';
import { asRow, readReport } from './source';

/**
 * `POST /api/reports/draft` — create or update a draft, and
 * `GET /api/reports/gather?clientId=&from=&to=` — the figures the practitioner
 * is about to review (docs/SPEC/reports-v1.md sections 4.2 and 7.1).
 *
 * **Two routes, because they are two different acts.** Gathering reads the
 * record and writes nothing; drafting writes what a person typed. Keeping them
 * apart is what lets the editor show the figures before anything exists to
 * save, and it is why a practitioner opening a draft never accidentally
 * creates one.
 *
 * **The figures are the server's and the words are the person's.** The draft
 * body is validated against its kind's declared shape and refused with the
 * field named; the gathered half is recomputed here from the record rather
 * than trusted from the request, because a figure a practitioner could retype
 * is a figure that can disagree with the record (section 4.2).
 *
 * **Only a draft may be updated.** An issued report is not edited: the guard
 * trigger refuses it in the database (migration 600) and this refuses it with
 * a sentence first, so a person is told to correct it with a new version
 * rather than shown a raise.
 */

const GatherQuery = z.object({
  clientId: z.uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** The visits a session report may be drafted from, for the picker. */
const VisitsQuery = z.object({ clientId: z.uuid() });

/** One visit's own figures, for the session editor. */
const SessionGatherQuery = z.object({
  clientId: z.uuid(),
  sessionId: z.uuid(),
  locale: z.enum(['en', 'ar']).default('en'),
});

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, service_type_id, ' +
  'coverage_from, coverage_to, content, created_by) values (' +
  'app.current_tenant_id(), $1, $2::report_kind, $3::locale, $4, $5::date, $6::date, $7::jsonb, ' +
  'app.current_actor_id()) returning id';

const UPDATE_SQL =
  'update report set locale = $2::locale, service_type_id = $3, coverage_from = $4::date, ' +
  'coverage_to = $5::date, content = $6::jsonb ' +
  'where tenant_id = app.current_tenant_id() and id = $1 returning id';

/**
 * What the practitioner has written, pulled out of the body they posted so it
 * can be put back into a freshly gathered one. Free text is boundary-cleaned
 * the way every other note in this platform is (`cleanText`).
 *
 * **The goals are paired by id.** The first build paired them by position, on
 * the argument that an internal row id has no business inside a household's
 * document. It has: `content` already carries the ids of the two assessments a
 * comparison was made from, for the same reason — a snapshot has to say what
 * it was made of. Paired by position, a goal added between the gathering and
 * the save shifted every line down one and put a sentence about sleep beside a
 * goal about school, silently and inside a signed document. The id is on each
 * goal line now, and a line whose goal is no longer there is dropped rather
 * than landing on a stranger.
 */
function narrativeOf(content: unknown): ProgressNarrative {
  const body = (content ?? {}) as { summary?: unknown; suggestion?: unknown; goals?: unknown };
  const movementByGoal: Record<string, string> = {};
  if (Array.isArray(body.goals)) {
    for (const goal of body.goals as { id?: unknown; movement?: unknown }[]) {
      if (typeof goal?.id !== 'string' || typeof goal.movement !== 'string') continue;
      movementByGoal[goal.id] = cleanText(goal.movement, 1000);
    }
  }
  return {
    summary: typeof body.summary === 'string' ? cleanText(body.summary, 4000) : '',
    suggestion: typeof body.suggestion === 'string' ? cleanText(body.suggestion, 2000) : '',
    movementByGoal,
  };
}

/** The two lines a person writes on a session report (section 5). */
function sessionNarrativeOf(content: unknown): SessionNarrative {
  const body = (content ?? {}) as { note?: unknown; beforeNextVisit?: unknown };
  return {
    note: typeof body.note === 'string' ? cleanText(body.note, 2000) : '',
    beforeNextVisit:
      typeof body.beforeNextVisit === 'string' ? cleanText(body.beforeNextVisit, 2000) : '',
  };
}

export function mountReportDraft(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/reports/gather', async (c) => {
    const requestId = c.get('requestId');
    const query = GatherQuery.safeParse({
      clientId: c.req.query('clientId'),
      from: c.req.query('from'),
      to: c.req.query('to'),
    });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const actor = c.get('actor');
    if (!mayDraftReport(actor, query.data.clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');

    // **A read, written before the answer** (section 8, and docs/SPEC/audit.md
    // section 5). This route answers a household's goals in their own words
    // and the figures of every completed visit inside the coverage. It writes
    // nothing to the record, which is exactly why it was easy to miss: what
    // makes a row worth a trail entry is what leaves, not what changes.
    await logRead(db, 'client', query.data.clientId, query.data.clientId);

    const timeZone = await practiceTimeZone(db);
    const gathered = await gatherForClient(db, {
      clientId: query.data.clientId,
      coverage: { from: query.data.from, to: query.data.to },
      timeZone,
    });
    return c.json(
      GatherResponse.parse({
        content: gathered.content,
        brainMapsRead: gathered.brainMapsRead,
      }),
    );
  });

  api.get('/api/reports/visits', async (c) => {
    const requestId = c.get('requestId');
    const query = VisitsQuery.safeParse({ clientId: c.req.query('clientId') });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const actor = c.get('actor');
    if (!mayDraftReport(actor, query.data.clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    // A read, before the answer: this says which days the practice visited
    // this household and who went (section 8).
    await logRead(db, 'client', query.data.clientId, query.data.clientId);
    const timeZone = await practiceTimeZone(db);
    return c.json(
      VisitsResponse.parse({ visits: await listVisits(db, query.data.clientId, timeZone) }),
    );
  });

  api.get('/api/reports/gather-session', async (c) => {
    const requestId = c.get('requestId');
    const query = SessionGatherQuery.safeParse({
      clientId: c.req.query('clientId'),
      sessionId: c.req.query('sessionId'),
      locale: c.req.query('locale') ?? 'en',
    });
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const actor = c.get('actor');
    if (!mayDraftReport(actor, query.data.clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    await logRead(db, 'client', query.data.clientId, query.data.clientId);
    const timeZone = await practiceTimeZone(db);
    const content = await gatherSession(db, {
      clientId: query.data.clientId,
      sessionId: query.data.sessionId,
      timeZone,
      locale: query.data.locale,
    });
    if (!content) {
      return c.json({ error: 'not_found', code: 'no_such_visit', requestId }, 404);
    }
    return c.json(GatherResponse.parse({ content, brainMapsRead: false }));
  });

  api.post('/api/reports/draft', async (c) => {
    const requestId = c.get('requestId');
    const parsed = DraftInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = parsed.data;
    const actor = c.get('actor');
    if (!mayDraftReport(actor, input.clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const db = c.get('db');
    if (input.id) {
      const existing = await readReport(db, input.id);
      if (!existing || existing.client_id !== input.clientId) {
        // Another practice's, another household's, or none. A 404 either way:
        // a 403 would confirm the report exists.
        return c.json({ error: 'not_found', requestId }, 404);
      }
      if (existing.status !== 'draft') {
        return c.json({ error: 'unprocessable', code: 'already_issued', requestId }, 422);
      }
    }

    // The figures come from the record, always. What the request carried of
    // them is thrown away; what it carried of the narrative is kept. Both
    // kinds are gathered, so nothing a caller sent survives as a figure.
    let content: unknown;
    if (input.kind === 'progress') {
      if (!input.coverageFrom || !input.coverageTo) {
        return c.json({ error: 'bad_request', code: 'coverage_required', requestId }, 400);
      }
      const timeZone = await practiceTimeZone(db);
      const gathered = await gatherForClient(db, {
        clientId: input.clientId,
        coverage: { from: input.coverageFrom, to: input.coverageTo },
        timeZone,
        // The pairing is `gatherProgress`'s, by goal id, and always has been:
        // this route used to gather without it and pair by position
        // afterwards, which was the fault.
        narrative: narrativeOf(input.content),
      });
      content = gathered.content;
    } else {
      // A session report follows one completed visit, and its figures come
      // from that visit for the reason the progress report's come from the
      // record: a figure a practitioner could retype is a figure that can
      // disagree with it (section 4.2). Only the note and what to expect
      // before the next visit are the person's.
      if (!input.sessionId) {
        return c.json({ error: 'bad_request', code: 'visit_required', requestId }, 400);
      }
      const timeZone = await practiceTimeZone(db);
      const gathered = await gatherSession(db, {
        clientId: input.clientId,
        sessionId: input.sessionId,
        timeZone,
        locale: input.locale,
        narrative: sessionNarrativeOf(input.content),
      });
      if (!gathered) {
        return c.json({ error: 'not_found', code: 'no_such_visit', requestId }, 404);
      }
      content = gathered;
    }

    const checked = validateContent(input.kind, content);
    if (!checked.ok) {
      // Named, so a practitioner is told which field rather than "invalid".
      return c.json(
        { error: 'bad_request', code: 'invalid_content', field: checked.field, requestId },
        400,
      );
    }

    const body = JSON.stringify(checked.content);
    const written = input.id
      ? await db.query<{ id: string }>(UPDATE_SQL, [
          input.id,
          input.locale,
          input.serviceTypeId,
          input.coverageFrom,
          input.coverageTo,
          body,
        ])
      : await db.query<{ id: string }>(INSERT_SQL, [
          input.clientId,
          input.kind,
          input.locale,
          input.serviceTypeId,
          input.coverageFrom,
          input.coverageTo,
          body,
        ]);
    const id = written.rows[0]?.id;
    if (!id) {
      // Row security refused the write. Not found rather than forbidden: the
      // client may be one this person cannot reach at all.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const record = await readReport(db, id);
    if (!record) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    return c.json(
      DraftResponse.parse({ report: asRow(record), content: record.content }),
      input.id ? 200 : 201,
    );
  });
}

/** The practice's own today, which every date rule is decided in. */
export function practiceToday(now: Date, timeZone: string): string {
  return isoDateIn(now, timeZone);
}
