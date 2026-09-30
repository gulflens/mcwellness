import type { Hono } from 'hono';
import { z } from 'zod';
import { isoDateIn } from '../../../../domain/shared';
import {
  prefillFollowUp,
  type EarlierReport,
  type PrefillRefusal,
} from '../../../../domain/reports/qeeg/prefill';
import { countedFigure } from '../../../../domain/reports/qeeg/sessionsCompleted';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import { logRead } from '../../_middleware/audit';
import type { ApiEnv } from '../../_middleware/request-context';
import { mayDraftReport } from '../access';
import { practiceTimeZone } from '../gather';
import { QeegPrefillResponse } from '../schema';
import { readReport } from '../source';
import { countedSessions } from './sessionsCounted';

/**
 * `GET /api/reports/qeeg/prefill?clientId=&from=&recordedOn=` — a follow-up
 * begun from an earlier report (docs/SPEC/reports-qeeg.md section 14, the
 * `GET /qeeg/prefill` row; section 16, point 7; brief S).
 *
 * **It answers, and writes nothing.** The earlier report, a signed report or a
 * kept past record, is read through row security as the caller and handed to
 * `prefillFollowUp`, which alone decides what comes forward: the earlier
 * scores, the earlier maps as the before side of each pair, what it is
 * compared with, and the client's handedness. Every judgement is left empty,
 * and what she chose last time is answered beside the content as `offered`,
 * for the form to suggest and never to fill in. No report row is written; the
 * form's first save is what makes the draft.
 *
 * **The sessions completed are counted** from the client's visits between
 * the earlier recording and the new one, every visit of the practice whoever
 * asks (`countedSessions`, migration 605), and answered in the content as a
 * counted figure, with the days the count ran between.
 *
 * **Refused in the function's order, each by its own code and sentence.**
 * `other_client` comes first, so nothing about another client's report, not
 * even its kind, is said to someone asking about this client, and such a
 * report's read is not logged against this one. A report the caller cannot
 * see is no report (404). Then the route's own `not_a_brain_map`, and every
 * refusal of `prefillFollowUp` in its order: an erased record, the draft
 * being filled, one replaced by a newer version, one never signed or kept, a
 * withdrawn past record, a reference that does not fit, no day of recording,
 * a request whose day is no day, and an earlier report recorded after the new
 * recording.
 *
 * **Audited as a report read.** The earlier report's read is logged before
 * anything of it is answered, a refusal included once it is known to be this
 * client's; the client's read is logged before the count of her visits and
 * the content leave. Who may ask is who may draft (`report.draft`), so a
 * household is refused (403), as is anyone else without it.
 */

const Query = z
  .object({
    clientId: z.uuid(),
    from: z.uuid(),
    /** The day of the new recording, when she has given it. Checked by the prefill. */
    recordedOn: z.string().max(32).optional(),
    stage: z.enum(['follow_up', 'final']).default('follow_up'),
    /** The draft being filled, when there is one, so it is not compared with itself. */
    draftId: z.uuid().optional(),
  })
  .strict();

const CLIENT_SQL =
  'select status::text as status from client where tenant_id = app.current_tenant_id() and id = $1';

export type PrefillCode = PrefillRefusal | 'no_such_report' | 'not_a_brain_map';

/** What each refusal says, as the route answers it. The form keeps its own words for each. */
export const PREFILL_SENTENCES: Readonly<Record<PrefillCode, string>> = Object.freeze({
  no_such_report: 'The earlier report chosen could not be found.',
  other_client: 'The earlier report chosen belongs to another client.',
  not_a_brain_map: 'The earlier report chosen is not a brain-map report.',
  erased: 'This client’s record has been erased, so nothing can be compared with it.',
  same_report: 'A report cannot be compared with itself.',
  superseded: 'The earlier report chosen has been replaced by a newer version.',
  draft: 'The earlier report chosen is still a draft.',
  withdrawn: 'The earlier report chosen was withdrawn.',
  no_reference: 'The earlier report chosen has no reference to name it by.',
  undated: 'The earlier report chosen has no recording date.',
  no_such_day: 'The recording date is not a real day.',
  recorded_later: 'This recording is dated before the report it is compared with.',
});

export function mountReportPrefill(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/reports/qeeg/prefill', async (c) => {
    const requestId = c.get('requestId');
    const query = Query.safeParse(c.req.query());
    if (!query.success) {
      return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
    }
    const input = query.data;
    if (!mayDraftReport(c.get('actor'), input.clientId, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const refuse = (code: PrefillCode, status: 404 | 422 = 422) =>
      c.json(
        {
          error: status === 404 ? 'not_found' : 'unprocessable',
          code,
          sentence: PREFILL_SENTENCES[code],
          requestId,
        },
        status,
      );

    const client = (await db.query<{ status: string }>(CLIENT_SQL, [input.clientId])).rows[0];
    if (!client) {
      // A client this person cannot reach is not there at all.
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const earlier = await readReport(db, input.from);
    if (!earlier) return refuse('no_such_report', 404);
    // Before anything else is said of it, its kind included.
    if (earlier.client_id !== input.clientId) return refuse('other_client');

    // This client's report: its read is on the trail from here, refusal or not.
    await logRead(db, 'report', earlier.id, earlier.client_id);
    if (earlier.kind !== 'qeeg') return refuse('not_a_brain_map');

    const report: EarlierReport = {
      reportId: earlier.id,
      clientId: earlier.client_id,
      status: earlier.status,
      withdrawn: earlier.withdrawn,
      erased: client.status === 'erased',
      reference: earlier.reference,
      // A stored body, read defensively: the prefill takes a part it cannot
      // read as not there.
      content: earlier.content as QeegContent,
    };
    const prefill = prefillFollowUp(report, {
      clientId: input.clientId,
      draftId: input.draftId ?? null,
      stage: input.stage,
      recordedOn: input.recordedOn ?? null,
    });
    if (!prefill.ok) return refuse(prefill.reason);

    // The count of her visits and the content are about to leave.
    await logRead(db, 'client', input.clientId, input.clientId);
    const counted = await countedSessions(db, {
      clientId: input.clientId,
      earlierDay: prefill.content.comparedWith.recordedOn,
      laterDay: prefill.content.recording.recordedOn,
      today: isoDateIn(now(), await practiceTimeZone(db)),
    });
    if (counted === null) {
      // The database's gate and the route's read a schedule differently at its edge.
      return c.json({ error: 'forbidden', code: 'not_permitted', requestId }, 403);
    }
    const content = {
      ...prefill.content,
      change: { ...prefill.content.change, sessionsCompleted: countedFigure(counted.count) },
    };
    return c.json(
      QeegPrefillResponse.parse({
        content,
        offered: prefill.offered,
        sessions: { count: counted.count, ...counted.window },
      }),
    );
  });
}
