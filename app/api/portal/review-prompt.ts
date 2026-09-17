import { randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { canActor } from '../../../domain/shared';
import { logAction } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { reviewStateFor } from './home';
import { readHousehold } from './household';
import { logPortalRefusal } from './refused';
import { AnswerReviewPromptInput, ReviewAnswerResponse } from './schema';

/**
 * `POST /api/portal/review-prompts` — the household answers the review line
 * (docs/SPEC/client-portal.md section 3.1 as amended 2026-09-17; the owner's
 * decision of 16 September 2026;
 * docs/superpowers/specs/2026-09-17-review-prompt-design.md).
 *
 * Two answers, and each ends the line for that milestone: the person opened
 * the practice's review page, or said not now. One row per milestone per
 * client (migration 704), whichever adult answered; a second answer is
 * idempotent rather than refused, because two phones pressing "not now" on
 * the same evening is not an error anybody needs to hear about.
 *
 * **The milestone has to be one the home is offering, or one already
 * answered.** The same computation the home makes (`reviewStateFor`) decides
 * it, so an id the household was never shown — forged, another client's, a
 * visit that was not a brain map — answers 404 and writes nothing: neither a
 * row here nor an audit row, since no row was reached (the security review's
 * finding). An already-answered milestone passes so a second press is the
 * idempotent nothing above. The shape of `POST /api/portal/requests` otherwise.
 */
export function mountPortalReviewPrompt(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
): void {
  api.post('/api/portal/review-prompts', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const body = AnswerReviewPromptInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      return c.json({ error: 'bad_request', code: String(field ?? 'invalid'), requestId }, 400);
    }
    const { clientId, milestoneKind, milestoneId, outcome } = body.data;

    const client = household.clients.find((row) => row.id === clientId) ?? null;
    if (client === null) {
      // Not this household's. The id was never in the set the database
      // resolved, so no row was reached and nothing is written to the trail.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const clientIds = household.clients.map((row) => row.id);
    if (!canActor(actor, { type: 'portal.review.answer', clientId }, { clientIds }, now())) {
      await logPortalRefusal(db, 'portal_review_prompt', randomUUID(), clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    if (!client.moneyVisible) {
      // The line is never shown to a young person's own login (the design
      // note's fourth call), so an answer from one names a line that was never
      // offered. Refused, and on the trail, as a screen that is not theirs is.
      await logPortalRefusal(db, 'portal_review_prompt', randomUUID(), clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const state = await reviewStateFor(db, household);
    const named = (row: { kind: string; id: string }) =>
      row.kind === milestoneKind && row.id === milestoneId;
    if (
      !state.offered.some((row) => row.clientId === clientId && named(row)) &&
      !state.answered.some(named)
    ) {
      return c.json({ error: 'not_found', requestId }, 404);
    }

    const id = randomUUID();
    const inserted = await db.query(
      'insert into portal_review_prompt (id, tenant_id, client_id, contact_id, milestone_kind, ' +
        'milestone_id, outcome, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) ' +
        'on conflict on constraint portal_review_prompt_once_per_milestone do nothing',
      [
        id,
        actor.tenantId,
        clientId,
        client.contactId,
        milestoneKind,
        milestoneId,
        outcome,
        actor.userId,
      ],
    );
    if (inserted.rowCount === 1) {
      // The row trigger has recorded the insert. This says which way the
      // household answered, with ids alone.
      await logAction(
        db,
        'portal.review.answered',
        { type: 'portal_review_prompt', id, clientId },
        { milestoneKind, outcome, contactId: client.contactId },
      );
    }

    return c.json(ReviewAnswerResponse.parse({ ok: true }));
  });
}
