import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor, toCsv } from '@domain/shared';
import {
  ENQUIRY_PAGE,
  carriesAPerson,
  dismissalKeeps,
  enquiryCursor,
  isMarketable,
  leadFromEnquiry,
  readEnquiryListQuery,
  tallyEnquiries,
  type EnquiringFor,
  type EnquirySource,
  type EnquiryStatus,
  type Interest,
  type LodgedEnquiry,
  type NoticeVersion,
} from '@domain/enquiry';
import { logAction, logReads, refuseContactDetails } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { csvResponse } from '../accounting/csv-response';
import { createLead } from '../clients/create-lead';
import {
  ConvertResponse,
  DismissBody,
  DismissResponse,
  EnquiryListResponse,
  type Enquiry,
} from './schema';

/**
 * What a person does with an enquiry (docs/superpowers/specs/2026-09-09-enquiries-design.md).
 * Behind the fence, so every route here has an actor; the rows themselves are
 * fenced again by row security to the same three roles.
 *
 * Reading the list is a read of personal data by a person and is logged as
 * one — for the rows that still carry any. Converting creates the lead
 * through the same function POST /api/clients uses, under this actor, so the
 * client is audited from its first byte; then the enquiry is scrubbed, which
 * the table's own constraint insists on. Dismissing scrubs the same way.
 */

type Row = {
  id: string;
  received_at: Date;
  source: EnquirySource;
  status: 'new' | 'converted' | 'dismissed';
  name: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  area: string | null;
  message: string | null;
  concern: string | null;
  preferred_time: string | null;
  contact_method: string | null;
  consent: boolean | null;
  enquiring_for: EnquiringFor | null;
  interest: Interest | null;
  notice_version: NoticeVersion;
  marketing_opt_in: boolean | null;
  actioned_at: Date | null;
  actioned_by_name: string | null;
  client_id: string | null;
  dismiss_reason: string | null;
};

const COLUMNS =
  'e.id, e.received_at, e.source, e.status, e.name, e.whatsapp_e164, e.email, e.area, ' +
  'e.message, e.concern, e.preferred_time, e.contact_method, e.consent, ' +
  'e.enquiring_for, e.interest, e.notice_version, e.marketing_opt_in, e.actioned_at, ' +
  'u.display_name as actioned_by_name, e.client_id, e.dismiss_reason';

const SCRUB =
  'name = null, whatsapp_e164 = null, email = null, area = null, message = null, ' +
  'concern = null, preferred_time = null, contact_method = null, consent = null, ip_hash = null, ' +
  'enquiring_for = null, interest = null, marketing_opt_in = null';

/**
 * A dismissal that keeps the person (migration 921): only the address hash
 * goes, which was there for the door's budget and has no follow-up purpose.
 */
const KEEP = 'ip_hash = null, message = null, concern = null';

/**
 * `isMarketable` (domain/enquiry/keep.ts) in the database's terms: they
 * ticked the box for news, they were dismissed, and they are still on the
 * row. The rule is the domain's. This string is only what narrows the query,
 * and the file is then built from the rows `isMarketable` itself lets through,
 * so a drift between the two can leave somebody out of the file and never put
 * somebody in. The route test lodges one of every kind and holds the count on
 * the screen to the length of the file.
 */
const MARKETABLE = "e.marketing_opt_in is true and e.name is not null and e.status = 'dismissed'";

/**
 * More than the practice will hold for years. Said rather than silent: the
 * file is cut here, oldest first, and the count on the button is of all of
 * them, so a list this long would show the difference.
 */
const NEWS_FILE_LIMIT = 5000;

const NEWS_FILE_HEADINGS = [
  'Name',
  'WhatsApp',
  'Email',
  'Area',
  'From',
  'Received',
  'Dismissed',
] as const;
const SOURCE_WORDS: Record<EnquirySource, string> = {
  website: 'Website',
  discovery_call: 'Discovery call',
  expo: 'Expo',
};

/** The two answers in words, for the file the office follows up from. */
const ENQUIRING_FOR_WORDS: Record<EnquiringFor, string> = {
  self: 'Themselves',
  child: 'A child',
  family_member: 'A family member',
  someone_else: 'Someone else',
};
const INTEREST_WORDS: Record<Interest, string> = {
  brain_map: 'Brain map',
  neurofeedback: 'Neurofeedback',
  both: 'Both',
};

const PRACTICE_TIME_ZONE = 'Asia/Dubai';
const FILE_STAMP = new Intl.DateTimeFormat('en-GB', {
  timeZone: PRACTICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** "2026-10-14 15:20" in the practice's own time, from the parts the formatter gives. */
function receivedStamp(at: Date): string {
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    FILE_STAMP.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}

const EXPO_FILE_HEADINGS = [
  'Received',
  'Name',
  'WhatsApp',
  'Email',
  'Area',
  'Enquiring for',
  'Interest',
  'Reason',
  'Agreed to be contacted',
] as const;

function toWire(row: Row): Enquiry {
  return {
    id: row.id,
    receivedAt: row.received_at.toISOString(),
    source: row.source,
    status: row.status,
    name: row.name,
    whatsappE164: row.whatsapp_e164,
    email: row.email,
    area: row.area,
    message: row.message,
    concern: row.concern,
    preferredTime: row.preferred_time,
    contactMethod: row.contact_method,
    consent: row.consent,
    enquiringFor: row.enquiring_for,
    interest: row.interest,
    noticeVersion: row.notice_version,
    marketingOptIn: row.marketing_opt_in,
    actionedAt: row.actioned_at ? row.actioned_at.toISOString() : null,
    actionedByName: row.actioned_by_name,
    clientId: row.client_id,
    dismissReason: row.dismiss_reason,
  };
}

export function mountEnquiries(api: Hono<ApiEnv>, now: () => Date): void {
  api.get('/api/enquiries', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const asked = readEnquiryListQuery({
      status: c.req.query('status'),
      source: c.req.query('source'),
      before: c.req.query('before'),
    });
    if (asked === null) {
      return c.json({ error: 'bad_request', field: 'query', requestId }, 400);
    }
    // One status, newest first, a page at a time: the index migration 916 cut
    // on (tenant_id, status, received_at desc) is this query's own. One row
    // past the page is asked for and never sent, which is how the page knows
    // whether there is another.
    //
    // The cursor is the database's own text for the moment, to the
    // microsecond. A `Date` keeps milliseconds, and a cursor cut there steps
    // over every row lodged later in the same millisecond, which at a stand
    // with a queue is not a corner.
    const { rows } = await db.query<Row & { cursor_at: string }>(
      `select ${COLUMNS}, ` +
        `to_char(e.received_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at ` +
        'from enquiry e left join app_user u on u.id = e.actioned_by ' +
        'where e.status = $1 and ($2::text is null or e.source = $2) ' +
        'and ($3::timestamptz is null or (e.received_at, e.id) < ($3::timestamptz, $4::uuid)) ' +
        `order by e.received_at desc, e.id desc limit ${ENQUIRY_PAGE + 1}`,
      [asked.status, asked.source, asked.before?.receivedAt ?? null, asked.before?.id ?? null],
    );
    const page = rows.slice(0, ENQUIRY_PAGE);
    const last = page.at(-1);
    const older =
      rows.length > ENQUIRY_PAGE && last
        ? enquiryCursor({ receivedAt: last.cursor_at, id: last.id })
        : null;

    const counted = await db.query<{ status: EnquiryStatus; source: EnquirySource; count: number }>(
      'select status, source, count(*)::int as count from enquiry group by status, source',
    );

    // A read of a row that names somebody is a read of somebody, and is
    // logged. Every waiting row is one; since migration 921 a dismissed row may
    // be. A row with nobody left on it reads nobody and logs nothing.
    await logReads(
      db,
      'enquiry',
      page.filter(carriesAPerson).map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    const wantNews = await db.query<{ n: number }>(
      `select count(*)::int as n from enquiry e where ${MARKETABLE}`,
    );
    return c.json(
      EnquiryListResponse.parse({
        enquiries: page.map(toWire),
        counts: tallyEnquiries(counted.rows),
        older,
        marketable: wantNews.rows[0]?.n ?? 0,
      }),
    );
  });

  /**
   * The people who asked for the practice's news, as a file (the operator's
   * decision of 19 September 2026). Only those who ticked the second wording's
   * optional box, were dismissed, and are still on a row: a person somebody has
   * handled, never one still waiting (`isMarketable`). Every one is a read of a person, and
   * the file is logged once as an export. What is done with it is the
   * practice's own act: a social platform it is given to receives personal
   * data, and docs/COMPLIANCE/approved-vendors.md says which may.
   */
  api.get('/api/enquiries/marketing.csv', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const found = await db.query<Row>(
      `select ${COLUMNS} from enquiry e left join app_user u on u.id = e.actioned_by ` +
        `where ${MARKETABLE} order by e.received_at asc limit ${NEWS_FILE_LIMIT}`,
    );
    // Who leaves the system is the domain's rule to decide, row by row.
    const rows = found.rows.filter((row) =>
      isMarketable({ status: row.status, name: row.name, marketingOptIn: row.marketing_opt_in }),
    );
    await logReads(
      db,
      'enquiry',
      rows.map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    await logAction(
      db,
      'export',
      { type: 'enquiry_export', id: requestId, clientId: null },
      { list: 'news', rows: String(rows.length) },
    );
    const table = [
      [...NEWS_FILE_HEADINGS],
      ...rows.map((row) => [
        row.name ?? '',
        row.whatsapp_e164 ?? '',
        row.email ?? '',
        row.area ?? '',
        SOURCE_WORDS[row.source],
        receivedStamp(row.received_at),
        row.actioned_at ? receivedStamp(row.actioned_at) : '',
      ]),
    ];
    const today = receivedStamp(now()).slice(0, 10);
    return csvResponse(c, `news-list-${today}.csv`, toCsv(table));
  });

  /**
   * The expo's leads as a file, for following up after the stand comes down:
   * every enquiry from the expo still waiting, oldest first, with the two
   * answers in words. A read of personal data by a person, so each row is
   * logged as one, and the export itself once as its own kind of entity
   * under the request that made it (the shape the activity feed's own read
   * uses, app/api/audit/activity.ts) — its own kind, so a record's timeline
   * never looks for an enquiry with a request's id. Nothing is sent
   * anywhere: the office downloads the file, and the file is then a copy of
   * these names and numbers that the scrub and an erasure cannot reach; the
   * screen says so beside the button.
   */
  api.get('/api/enquiries/expo.csv', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.list' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from enquiry e left join app_user u on u.id = e.actioned_by ` +
        "where e.source = 'expo' and e.status = 'new' order by e.received_at asc limit 1000",
    );
    await logReads(
      db,
      'enquiry',
      rows.map((row) => ({ id: row.id, clientId: null })),
      'list',
    );
    await logAction(
      db,
      'export',
      { type: 'enquiry_export', id: requestId, clientId: null },
      { source: 'expo', rows: String(rows.length) },
    );
    const table = [
      [...EXPO_FILE_HEADINGS],
      ...rows.map((row) => [
        receivedStamp(row.received_at),
        row.name ?? '',
        row.whatsapp_e164 ?? '',
        row.email ?? '',
        row.area ?? '',
        row.enquiring_for ? ENQUIRING_FOR_WORDS[row.enquiring_for] : '',
        row.interest ? INTEREST_WORDS[row.interest] : '',
        row.message ?? '',
        row.consent === null ? '' : row.consent ? 'Yes' : 'No',
      ]),
    ];
    const today = receivedStamp(now()).slice(0, 10);
    return csvResponse(c, `expo-leads-${today}.csv`, toCsv(table));
  });

  api.post('/api/enquiries/:id/convert', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.action' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const idParam = z.uuid().safeParse(c.req.param('id'));
    if (!idParam.success) return c.json({ error: 'not_found', requestId }, 404);
    const id = idParam.data;
    const { rows } = await db.query<Row>(
      `select ${COLUMNS} from enquiry e left join app_user u on u.id = e.actioned_by ` +
        "where e.id = $1 and e.status = 'new' for update of e",
      [id],
    );
    const row = rows[0];
    if (!row || !row.name || !row.whatsapp_e164) {
      // Not there, not this practice's, or already actioned: one answer.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const enquiry: LodgedEnquiry = {
      name: row.name,
      whatsappE164: row.whatsapp_e164,
      email: row.email,
      area: row.area,
      message: row.message,
      concern: row.concern,
      preferredTime: row.preferred_time,
      contactMethod: row.contact_method,
      consent: row.consent,
      source: row.source,
      enquiringFor: row.enquiring_for,
      interest: row.interest,
      noticeVersion: row.notice_version,
      marketingOptIn: row.marketing_opt_in,
    };
    // The one read of a row's personal fields outside the list, logged as one.
    await logReads(db, 'enquiry', [{ id, clientId: null }], 'read');
    const lead = leadFromEnquiry(enquiry);
    const { clientId, mrn } = await createLead(db, actor.tenantId, lead);
    const updated = await db.query(
      `update enquiry set status = 'converted', client_id = $2, actioned_at = now(), actioned_by = $3, ${SCRUB} ` +
        "where id = $1 and status = 'new'",
      [id, clientId, actor.userId],
    );
    if (updated.rowCount !== 1) {
      throw new Error('The enquiry could not be marked converted after its lead was created.');
    }
    // What happened to the enquiry, in the chain, under the person who did it.
    await logAction(db, 'convert', { type: 'enquiry', id, clientId }, { source: row.source });
    return c.json(ConvertResponse.parse({ clientId, mrn }), 201);
  });

  api.post('/api/enquiries/:id/dismiss', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.action' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const body = DismissBody.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) {
      return c.json({ error: 'bad_request', field: 'reason', requestId }, 400);
    }
    try {
      // A number or an address in the reason would put a person on a row in a
      // column that is never erased: the reason outlives the scrub.
      refuseContactDetails({ reason: body.data.reason });
    } catch {
      return c.json({ error: 'bad_request', field: 'reason', requestId }, 400);
    }
    const idParam = z.uuid().safeParse(c.req.param('id'));
    if (!idParam.success) return c.json({ error: 'not_found', requestId }, 404);
    const id = idParam.data;
    // Which wording this person read decides what may be kept of them, so it
    // is read under the same lock the update takes. A person promised that the
    // enquiry "keeps nothing personal" is erased whatever was chosen here; the
    // table refuses anything else (migration 921).
    const found = await db.query<{ notice_version: NoticeVersion }>(
      "select notice_version from enquiry where id = $1 and status = 'new' for update",
      [id],
    );
    const noticeVersion = found.rows[0]?.notice_version;
    if (noticeVersion === undefined) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    const kept = dismissalKeeps({ noticeVersion, erase: body.data.erase === true });
    const updated = await db.query<{ source: string }>(
      `update enquiry set status = 'dismissed', dismiss_reason = $2, actioned_at = now(), actioned_by = $3, ${kept ? KEEP : SCRUB} ` +
        "where id = $1 and status = 'new' returning source",
      [id, body.data.reason, actor.userId],
    );
    if (updated.rowCount !== 1) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logAction(
      db,
      'dismiss',
      { type: 'enquiry', id, clientId: null },
      { source: updated.rows[0]?.source ?? '', kept: kept ? 'yes' : 'no' },
    );
    return c.json(DismissResponse.parse({ ok: true, kept }));
  });

  /**
   * Erases the person from a dismissed enquiry that kept them: somebody asked
   * to be forgotten, or the row was never worth keeping. The row stays, with
   * when it came, from where, who dismissed it and why. Once only: a row with
   * nobody on it answers not found, as does any row that is not dismissed.
   */
  api.post('/api/enquiries/:id/erase', async (c) => {
    const actor = c.get('actor');
    const db = c.get('db');
    const requestId = c.get('requestId');
    if (!canActor(actor, { type: 'enquiry.action' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const idParam = z.uuid().safeParse(c.req.param('id'));
    if (!idParam.success) return c.json({ error: 'not_found', requestId }, 404);
    const id = idParam.data;
    const updated = await db.query<{ source: string }>(
      `update enquiry set ${SCRUB} ` +
        "where id = $1 and status = 'dismissed' and name is not null returning source",
      [id],
    );
    if (updated.rowCount !== 1) {
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logAction(
      db,
      'erase',
      { type: 'enquiry', id, clientId: null },
      { source: updated.rows[0]?.source ?? '' },
    );
    return c.json({ ok: true });
  });
}
