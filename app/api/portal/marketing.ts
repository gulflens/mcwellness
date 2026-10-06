import type { Hono } from 'hono';
import { z } from 'zod';
import {
  marketingConsentOfferedTo,
  marketingStanding,
  type MarketingConsentRow,
} from '../../../domain/portal';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { auditDocumentRead } from '../_middleware/storage/audit';
import { readHousehold, type Household } from './household';
import { attempt } from './attempt';
import { GiveMarketingInput, Locale, MarketingResponse, WordingResponse } from './schema';

/**
 * The marketing consent on Agreements (the push memo's decision 1,
 * docs/OPERATOR/2026-09-17-push-notifications.md, answered "as recommended"
 * on 6 October 2026; the wording is docs/CONSENT/marketing.en.md and .ar.md).
 *
 * - `GET /api/portal/marketing` — where the person's own switch stands, and
 *   the wording it stands beside, in both languages.
 * - `GET /api/portal/marketing/wording/:locale` — that wording, as a signed
 *   link good for five minutes, the way every wording is opened.
 * - `POST /api/portal/marketing` — turned on, against the wording the person
 *   read, by its id.
 * - `POST /api/portal/marketing/withdraw` — turned off. One press, at once.
 *
 * **The first consent the portal itself records and withdraws**, and the only
 * one: every other purpose is still asked of the practice through a request
 * (agreements.ts). It is kept to this one purpose beneath the route as well —
 * the household has no write on `consent`, and these two routes reach it
 * only through migration 706's two functions, each for `marketing` alone.
 *
 * **The person's own, never another adult's.** The rows read here are the
 * ones the person gave, through their own contact rows; a father's switch on
 * the same record is his and is never shown to the mother as hers.
 *
 * Every row read is logged as read, and both writes say what happened, with
 * ids alone; the row trigger records each consent row, and the reason it
 * carries says it came from the portal's switch.
 */

const OWN_ROWS_SQL =
  'select cs.id, cs.client_id, cs.status::text as status, cs.given_at, cs.withdrawn_at, ' +
  'cs.text_document_id from consent cs ' +
  'join contact ct on ct.id = cs.given_by_contact_id and ct.tenant_id = cs.tenant_id ' +
  'join client cl on cl.id = cs.client_id and cl.tenant_id = cs.tenant_id ' +
  // The switch's own rows: a marketing row filed any other way is not the
  // person's switch, and the audience never reads it either (706, 707).
  "where cs.tenant_id = app.current_tenant_id() and cs.purpose = 'marketing' " +
  "and cs.method = 'portal_switch' " +
  "and ct.user_id = $1 and cl.status <> 'erased' order by cs.given_at, cs.id";

type OwnRow = {
  id: string;
  client_id: string;
  status: MarketingConsentRow['status'];
  given_at: Date;
  withdrawn_at: Date | null;
  text_document_id: string;
};

const LocaleParams = z.object({ locale: Locale });

const REASON_SQL = "select set_config('app.reason', $1, true)";

async function ownRows(db: Db, userId: string): Promise<OwnRow[]> {
  return (await db.query<OwnRow>(OWN_ROWS_SQL, [userId])).rows;
}

function viewerOf(household: Household) {
  return household.clients.map((client) => ({
    relationship: client.relationship,
    dateOfBirth: client.dateOfBirth,
  }));
}

async function wording(
  db: Db,
  locale: 'en' | 'ar',
): Promise<{ id: string; version: string; storage_key: string } | null> {
  const rows = await db.query<{ id: string; version: string; storage_key: string }>(
    'select id, version, storage_key from app.portal_marketing_wording($1::locale)',
    [locale],
  );
  return rows.rows[0] ?? null;
}

async function answer(db: Db, userId: string, household: Household): Promise<MarketingResponse> {
  const rows = await ownRows(db, userId);
  await logReads(
    db,
    'consent',
    rows.map((row) => ({ id: row.id, clientId: row.client_id })),
    'list',
  );
  const standing = marketingStanding(
    rows.map((row) => ({
      id: row.id,
      status: row.status,
      givenAt: row.given_at.toISOString(),
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
      wordingId: row.text_document_id,
    })),
  );
  const [en, ar] = await Promise.all([wording(db, 'en'), wording(db, 'ar')]);
  return MarketingResponse.parse({
    offered: marketingConsentOfferedTo(viewerOf(household), household.today),
    state: standing.state,
    since: standing.since,
    wordings: {
      en: en === null ? null : { id: en.id, version: en.version },
      ar: ar === null ? null : { id: ar.id, version: ar.version },
    },
  });
}

export function mountPortalMarketing(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/marketing', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    return c.json(await answer(db, actor.userId, household));
  });

  api.get('/api/portal/marketing/wording/:locale', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const params = LocaleParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const household = await readHousehold(db, c.get('actor'), now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    const storage = c.get('storage');
    if (!storage) return c.json({ error: 'storage_unavailable', requestId }, 503);

    const found = await wording(db, params.data.locale);
    if (found === null) return c.json({ error: 'not_found', requestId }, 404);
    // A wording belongs to no client: null is the honest answer in the trail.
    await auditDocumentRead(db, { id: found.id, clientId: null });
    const url = await storage.getSignedUrl(found.storage_key, DEFAULT_SIGNED_URL_TTL_SECONDS);
    return c.json(
      WordingResponse.parse({
        id: found.id,
        purpose: 'marketing',
        locale: params.data.locale,
        version: found.version,
        status: 'approved',
        mimeType: 'text/markdown',
        textUrl: url,
        expiresInSeconds: DEFAULT_SIGNED_URL_TTL_SECONDS,
      }),
    );
  });

  api.post('/api/portal/marketing', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);
    if (!marketingConsentOfferedTo(viewerOf(household), household.today)) {
      return c.json({ error: 'not_offered', requestId }, 403);
    }
    const body = GiveMarketingInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'bad_request', requestId }, 400);

    await db.query(REASON_SQL, ['marketing consent turned on in the portal']);
    const given = await attempt(db, () =>
      db.query<{ id: string }>('select app.portal_give_marketing_consent($1) as id', [
        body.data.wordingId,
      ]),
    );
    if (!given.ok) {
      if (given.code === '23505') return c.json({ error: 'already_given', requestId }, 409);
      if (given.code === '23514') return c.json({ error: 'wording_not_current', requestId }, 422);
      if (given.code === '42501') return c.json({ error: 'not_offered', requestId }, 403);
      throw given.error;
    }
    const ids = given.value.rows.map((row) => row.id);
    const rows = (await ownRows(db, actor.userId)).filter((row) => ids.includes(row.id));
    for (const row of rows) {
      await logAction(
        db,
        'portal.marketing.given',
        { type: 'consent', id: row.id, clientId: row.client_id },
        { wordingId: body.data.wordingId },
      );
    }
    return c.json(await answer(db, actor.userId, household), 201);
  });

  api.post('/api/portal/marketing/withdraw', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const standing = (await ownRows(db, actor.userId)).filter((row) => row.status === 'active');
    if (standing.length === 0) return c.json({ error: 'not_given', requestId }, 409);

    await db.query(REASON_SQL, ['marketing consent turned off in the portal']);
    const withdrawn = await attempt(db, () =>
      db.query<{ n: number }>('select app.portal_withdraw_marketing_consent() as n'),
    );
    if (!withdrawn.ok) {
      if (withdrawn.code === '42501') return c.json({ error: 'forbidden', requestId }, 403);
      throw withdrawn.error;
    }
    for (const row of standing) {
      await logAction(
        db,
        'portal.marketing.withdrawn',
        { type: 'consent', id: row.id, clientId: row.client_id },
        {},
      );
    }
    return c.json(await answer(db, actor.userId, household));
  });
}
