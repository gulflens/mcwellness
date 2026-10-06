import type { Context } from 'hono';
import { isoDateIn } from '../../../domain/shared';
import {
  assembleDraft,
  routeOwnedIn,
  subjectFrom,
} from '../../../domain/reports/qeeg/draftRequest';
import { figuresNamedIn } from '../../../domain/reports/qeeg/figuresNamed';
import { prefillFollowUp, type EarlierReport } from '../../../domain/reports/qeeg/prefill';
import { validateQeegContent } from '../../../domain/reports/qeeg/shape';
import { isRecord } from '../../../domain/reports/qeeg/text';
import type { Locale, QeegContent, QeegFollowUp } from '../../../domain/reports/qeeg/types';
import { twinChangeIn } from '../../../domain/reports/qeeg/twin';
import { isUuid } from '../billing/ids';
import { logAction, logRead } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import { requiredReason } from './reason';
import { practiceTimeZone } from './gather';
import { brainMapService } from './qeeg/brainMapService';
import { brainMapConsentGate } from './qeeg/consentGate';
import { countedSessions } from './qeeg/sessionsCounted';
import { QeegDraftInput, QeegDraftResponse } from './schema';
import { asRow, readReport, type ReportRecord } from './source';

/**
 * `POST /api/reports/draft` for a brain-map (qEEG) report: create or update a
 * DRAFT (docs/SPEC/reports-qeeg.md sections 4 and 14). The two older kinds are
 * `draft.ts`'s; that file hands a body whose kind is `qeeg` here.
 *
 * **What she typed is the shape's to judge, as she sent it.** The body goes to
 * `validateQeegContent` with nothing of hers read, cleaned or dropped on the
 * way, so a field that is wrong is refused with its path, and a mark that is
 * nearly a mark is refused rather than lost (RC4 note N2). A day of recording
 * that is no day is refused once, for being no day: the route asks the
 * comparison of no day, the shape asks it only of two real ones (RC4 note N1).
 *
 * **What the server works out is never taken from the request** (section 4,
 * rule 11). The client's Arabic name, age on the day of the recording and sex
 * are read from the record on EVERY save, so a correction to the record
 * reaches the draft at its next save. Where a report came from is the app: a
 * draft read from the old tool's file is the import's door (a later task), and
 * this route refuses to touch one. What a follow-up is compared with is read
 * from that report itself: its day, whether it was signed or brought in, its
 * reference, and whether it was the client's first, as `prefillFollowUp`
 * says, with every refusal that function names. A request that carries any of
 * those parts, or a calculated figure, is refused by name (`routeOwnedIn`),
 * and nothing is written. A count of sessions said to be counted from the
 * visits is counted again from them (`countedSessions`, brief S), as the
 * earlier scores are written again from the earlier report; only a count
 * marked typed is kept from the request.
 *
 * **A save made over a newer one is refused.** An update names the stamp of
 * the save it was made over (`savedAt`, the row's last write, to the
 * microsecond). The update is conditional on it, so of two tabs holding the
 * same draft the second to save is told, with 409, rather than silently
 * replacing the first's work. The row lock the update takes makes the check
 * and the write one step.
 *
 * **Every save carries a reason** (`X-Reason`). The fence stamps it on the
 * transaction, and the audit trigger records it with the row the save wrote,
 * and with the two reads this route makes first: the client's record, and the
 * report a follow-up is compared with. The screen saves at rest points, not on
 * every keystroke, because each save is a row on the trail (section 15).
 *
 * **The maps it names are its own** (brief L, "For PR 7"; migration 604). A
 * picture named in `maps` or on the later side of a follow-up's pair must be
 * linked to this report in `report_figure` — uploaded through its door — with
 * the digest and the size the link holds, or the save is refused naming the
 * field. The earlier side of a pair is the earlier report's picture, written
 * here from that report, and is linked by borrowing it in the same write. So a
 * saved draft names only pictures it holds, and the preview and the signing
 * resolve each through that link.
 *
 * **No idempotency key.** Neither of the older kinds' saves has one. A repeated
 * create makes a second draft, as theirs does; a repeated update is refused
 * as stale, which is harmless.
 */

const CLIENT_SQL =
  'select given_name_ar, family_name_ar, ' +
  "to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, " +
  'sex_at_birth::text as sex_at_birth, status::text as status ' +
  'from client where tenant_id = app.current_tenant_id() and id = $1';

const INSERT_SQL =
  'insert into report (tenant_id, client_id, kind, locale, service_type_id, compared_with_id, ' +
  "content, created_by) values (app.current_tenant_id(), $1, 'qeeg', $2::locale, $3, $4, " +
  '$5::jsonb, app.current_actor_id()) returning id';

/**
 * Only a brain-map draft, and only the save it was made over. Kind and status
 * are asked again here, not only read before, so the write is refused if
 * either moved in between.
 */
const UPDATE_SQL =
  'update report set service_type_id = $2, compared_with_id = $3, content = $4::jsonb ' +
  "where tenant_id = app.current_tenant_id() and id = $1 and kind = 'qeeg' " +
  "and status = 'draft' and imported_from is null and updated_at = $5::timestamptz " +
  'returning id';

type ClientRow = {
  given_name_ar: string | null;
  family_name_ar: string | null;
  date_of_birth: string | null;
  sex_at_birth: 'female' | 'male' | 'unknown' | null;
  status: string;
};

/** The database refusing a link to a report that can no longer be compared with. */
function isComparisonRefused(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, constraint } = error as { code?: unknown; constraint?: unknown };
  return code === '23503' && constraint === 'report_compared_with_comparable';
}

/** A key's own value, never one its prototype answers to. */
function own(record: unknown, key: string): unknown {
  return isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;
}

type Compared = { ok: true; followUp: QeegFollowUp } | { ok: false; reason: string };

/**
 * The earlier report a follow-up names, brought forward: what it is compared
 * with, its scores and its maps. Read through row security as the caller, so
 * a report they may not see is no report at all.
 */
async function comparedFrom(
  db: Db,
  reportId: string,
  request: { clientId: string; draftId: string | null; erased: boolean },
): Promise<Compared> {
  const earlier = await readReport(db, reportId);
  if (!earlier) return { ok: false, reason: 'no_such_report' };
  switch (earlier.kind) {
    case 'qeeg':
      break;
    case 'session':
    case 'progress':
    case 'external':
      return { ok: false, reason: 'not_a_brain_map' };
    default: {
      const unknown: never = earlier.kind;
      return { ok: false, reason: String(unknown) };
    }
  }
  // Read before anything of it is answered: its day, reference and scores
  // are about to be written into this draft and handed back.
  await logRead(db, 'report', earlier.id, earlier.client_id);
  const report: EarlierReport = {
    reportId: earlier.id,
    clientId: earlier.client_id,
    status: earlier.status,
    withdrawn: earlier.withdrawn,
    erased: request.erased,
    reference: earlier.reference,
    // A stored body, read defensively: `prefillFollowUp` takes any part it
    // cannot read as not there, and refuses a report with no day of its own.
    content: earlier.content as QeegContent,
  };
  // No day is asked: the shape compares the two days, and only when both are
  // days (RC4 note N1).
  const prefill = prefillFollowUp(report, {
    clientId: request.clientId,
    draftId: request.draftId,
    stage: 'follow_up',
    recordedOn: null,
  });
  return prefill.ok ? { ok: true, followUp: prefill.content } : prefill;
}

type LinkedFigure = { document_id: string; sha256: string; width_px: number; height_px: number };

type Unowned = {
  status: 400 | 403 | 422;
  body: { error: string; code: string; field: string; reason?: string };
};

/**
 * Whether every picture the content names is linked to this report in
 * `report_figure` (migration 604), with the digest and the size the link
 * holds; the first that is not, by the path of the field that names it.
 *
 * The earlier picture of a follow-up's pair is the earlier report's, written
 * here from that report and never from the request, so it is linked by
 * BORROWING it (docs/SPEC/reports-qeeg.md section 9, point 7): the borrow is
 * what makes it this report's own. A picture the earlier report does not hold
 * cannot be borrowed, and the comparison is refused, as prefill's own reasons
 * are. Every other picture was uploaded to this report through its door, or
 * the save is refused naming it.
 */
async function figuresNotOwned(
  db: Db,
  reportId: string,
  comparedWithId: string | null,
  content: QeegContent,
): Promise<Unowned | null> {
  const named = figuresNamedIn(content);
  if (named.length === 0) return null;

  for (const figure of named) {
    if (!figure.borrowed || comparedWithId === null) continue;
    await db.query('savepoint qeeg_draft_borrow');
    try {
      await db.query('select app.borrow_report_figure($1, $2, $3)', [
        reportId,
        comparedWithId,
        figure.ref.figureId,
      ]);
      await db.query('release savepoint qeeg_draft_borrow');
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      if (code === '42501') {
        // The route and the database read who may touch a report's maps
        // differently at the edge of a schedule: an answer, not a 500.
        await db.query('rollback to savepoint qeeg_draft_borrow');
        return {
          status: 403,
          body: { error: 'forbidden', code: 'not_permitted', field: `${figure.path}.figureId` },
        };
      }
      if (code !== '23503' && code !== '23001') throw error;
      await db.query('rollback to savepoint qeeg_draft_borrow');
      return {
        status: 422,
        body: {
          error: 'unprocessable',
          code: 'cannot_compare',
          reason: 'map_not_held',
          field: `${figure.path}.figureId`,
        },
      };
    }
  }

  const found = await db.query<LinkedFigure>(
    "select document_id, encode(sha256, 'hex') as sha256, width_px, height_px " +
      'from report_figure where tenant_id = app.current_tenant_id() and report_id = $1',
    [reportId],
  );
  const links = new Map(found.rows.map((row) => [row.document_id, row]));
  for (const figure of named) {
    const link = links.get(figure.ref.figureId);
    if (!link) {
      return {
        status: 400,
        body: { error: 'bad_request', code: 'unlinked_figure', field: `${figure.path}.figureId` },
      };
    }
    const differs =
      link.sha256 !== figure.ref.sha256
        ? 'sha256'
        : link.width_px !== figure.ref.widthPx
          ? 'widthPx'
          : link.height_px !== figure.ref.heightPx
            ? 'heightPx'
            : null;
    if (differs !== null) {
      return {
        status: 400,
        body: { error: 'bad_request', code: 'figure_mismatch', field: `${figure.path}.${differs}` },
      };
    }
  }
  return null;
}

/**
 * A refusal of who is saving, written to the trail before the answer
 * (docs/SPEC/reports-v1.md section 8), as `report.draft_refused` against the
 * client the draft is about: a new draft has no report yet to name.
 */
async function logDraftRefused(db: Db, clientId: string, reason: string): Promise<void> {
  await logAction(
    db,
    'report.draft_refused',
    { type: 'client', id: clientId, clientId },
    { reason },
  );
}

export async function saveQeegDraft(
  c: Context<ApiEnv>,
  raw: unknown,
  now: () => Date,
): Promise<Response> {
  const requestId = c.get('requestId');
  const parsed = QeegDraftInput.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'bad_request', code: 'invalid_request', requestId }, 400);
  }
  const input = parsed.data;
  if (!mayDraftReport(c.get('actor'), input.clientId, now())) {
    await logDraftRefused(c.get('db'), input.clientId, 'not_permitted');
    return c.json({ error: 'forbidden', requestId }, 403);
  }
  if ((await requiredReason(c.get('db'))) === null) {
    return c.json({ error: 'reason_required', requestId }, 400);
  }
  const sent = input.content;
  if (!isRecord(sent)) {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_content',
        field: '',
        refusals: [{ path: '', reason: 'A report body is a set of fields.' }],
        requestId,
      },
      400,
    );
  }
  const owned = routeOwnedIn(sent);
  if (owned.length > 0) {
    return c.json(
      { error: 'bad_request', code: 'route_owned', field: owned[0], fields: owned, requestId },
      400,
    );
  }

  const db = c.get('db');
  /** The signed report a second-language draft was made from, when this is one. */
  let twinOf: ReportRecord | null = null;
  let twinLocale: Locale = 'en';
  if (input.id) {
    const existing = await readReport(db, input.id);
    if (!existing || existing.client_id !== input.clientId) {
      // Another practice's, another household's, or none: a 403 would
      // confirm it exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (existing.kind !== 'qeeg') {
      return c.json({ error: 'unprocessable', code: 'wrong_kind', requestId }, 422);
    }
    if (existing.status === 'imported') {
      // A kept past record is frozen, and was never this door's.
      return c.json({ error: 'unprocessable', code: 'imported_record', requestId }, 422);
    }
    if (existing.status !== 'draft') {
      return c.json({ error: 'unprocessable', code: 'already_issued', requestId }, 422);
    }
    if (existing.imported_from !== null) {
      // Read from the old tool's file: its source is the import's to keep,
      // and it is reviewed and kept through that door, not saved over here.
      return c.json({ error: 'unprocessable', code: 'imported_draft', requestId }, 422);
    }
    if (input.locale !== undefined && input.locale !== existing.locale) {
      return c.json({ error: 'unprocessable', code: 'locale_fixed', requestId }, 422);
    }
    if (existing.twin_of_id !== null) {
      twinOf = await readReport(db, existing.twin_of_id);
      if (!twinOf) return c.json({ error: 'not_found', requestId }, 404);
      twinLocale = existing.locale;
    }
  }

  const found = await db.query<ClientRow>(CLIENT_SQL, [input.clientId]);
  const client = found.rows[0];
  if (!client) {
    // A client this person cannot reach is not there at all.
    return c.json({ error: 'not_found', requestId }, 404);
  }
  if (client.status === 'erased') {
    // Only the owner and the lead practitioner can see an erased record at
    // all, and a report about a person who asked to be erased is not one to
    // begin or go on writing, whoever asks.
    return c.json({ error: 'unprocessable', code: 'client_erased', requestId }, 422);
  }
  // The household's agreements, at the moment of writing, asked only once the
  // client is known to be visible and not erased: a brain-map report holds
  // health data (round 74, domain/reports/qeeg/consents.ts).
  const consentRefusals = await brainMapConsentGate(c.get('db'), input.clientId, now());
  if (consentRefusals.length > 0) {
    await logDraftRefused(c.get('db'), input.clientId, consentRefusals[0] ?? 'consent_missing');
    return c.json(
      { error: 'conflict', code: 'consent_missing', missing: consentRefusals, requestId },
      409,
    );
  }

  // The record was read, and its details are about to leave in the answer.
  await logRead(db, 'client', input.clientId, input.clientId);

  if (twinOf !== null) {
    return saveTwin(c, input, sent, twinOf, twinLocale, raw);
  }

  let followUp: QeegFollowUp | null = null;
  if (own(sent, 'edition') === 'follow-up') {
    const reportId = own(own(sent, 'comparedWith'), 'reportId');
    if (typeof reportId !== 'string' || !isUuid(reportId)) {
      return c.json(
        {
          error: 'bad_request',
          code: 'invalid_content',
          field: 'comparedWith.reportId',
          refusals: [
            { path: 'comparedWith.reportId', reason: 'A follow-up names the report it follows.' },
          ],
          requestId,
        },
        400,
      );
    }
    const compared = await comparedFrom(db, reportId, {
      clientId: input.clientId,
      draftId: input.id ?? null,
      erased: false,
    });
    if (!compared.ok) {
      return c.json(
        {
          error: 'unprocessable',
          code: 'cannot_compare',
          reason: compared.reason,
          field: 'comparedWith.reportId',
          requestId,
        },
        422,
      );
    }
    followUp = compared.followUp;
  }

  const recordedOn = own(own(sent, 'recording'), 'recordedOn');
  const timeZone = await practiceTimeZone(db);
  const today = isoDateIn(now(), timeZone);

  // A count of sessions said to be counted is counted again, from the visits
  // between the two recordings (brief S). Only one marked typed is hers.
  let counted: number | null | undefined;
  if (
    followUp !== null &&
    own(own(own(sent, 'change'), 'sessionsCompleted'), 'source') === 'gathered'
  ) {
    const found = await countedSessions(db, {
      clientId: input.clientId,
      earlierDay: followUp.comparedWith.recordedOn,
      laterDay: typeof recordedOn === 'string' ? recordedOn : null,
      today,
    });
    if (found === null) {
      await logDraftRefused(db, input.clientId, 'not_permitted');
      return c.json({ error: 'forbidden', code: 'not_permitted', requestId }, 403);
    }
    counted = found.count;
  }

  const subject = subjectFrom(
    {
      givenNameAr: client.given_name_ar,
      familyNameAr: client.family_name_ar,
      dateOfBirth: client.date_of_birth,
      sexAtBirth: client.sex_at_birth,
    },
    {
      recordedOn: typeof recordedOn === 'string' ? recordedOn : null,
      today,
    },
  );
  const checked = validateQeegContent(assembleDraft(sent, { subject, followUp, counted }));
  if (!checked.ok) {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_content',
        field: checked.refusals[0]?.path ?? '',
        refusals: checked.refusals,
        requestId,
      },
      400,
    );
  }

  let comparedWithId: string | null;
  switch (checked.content.edition) {
    case 'initial':
      comparedWithId = null;
      break;
    case 'follow-up':
      comparedWithId = checked.content.comparedWith.reportId;
      break;
    default: {
      const unknown: never = checked.content;
      return unknown;
    }
  }
  // The service is the route's: a brain-map report is written under the
  // practice's brain-map service, never one a request names (the operator's
  // decision of 6 October 2026), so only that service's credential signs it.
  const service = await brainMapService(c.get('db'));
  if (input.serviceTypeId !== null && input.serviceTypeId !== service) {
    return c.json(
      {
        error: 'bad_request',
        code: 'route_owned',
        field: 'serviceTypeId',
        fields: ['serviceTypeId'],
        requestId,
      },
      400,
    );
  }
  return writeDraft(c, input, checked.content, { comparedWithId, serviceTypeId: service });
}

/**
 * The write itself, for a first save or an update, and the answer. Shared by
 * a report's own saves and a second-language draft's (`saveTwin`), which
 * differ only in where the body and its links come from.
 */
async function writeDraft(
  c: Context<ApiEnv>,
  input: QeegDraftInput,
  content: QeegContent,
  row: { comparedWithId: string | null; serviceTypeId: string | null },
): Promise<Response> {
  const requestId = c.get('requestId');
  const db = c.get('db');
  const { comparedWithId } = row;
  const body = JSON.stringify(content);
  // The write in a savepoint of its own. What a follow-up is compared with
  // was read above; if it was withdrawn since, the database refuses the link
  // (`report_compared_with_comparable`, 603). That refusal is an answer, not a
  // fault, so it is rolled back to here and the request goes on to say so: a
  // caught error left standing would abort the transaction, and the fence
  // would turn the answer into a 500.
  await db.query('savepoint qeeg_draft_write');
  let written: { rows: { id: string }[] };
  try {
    written = input.id
      ? await db.query<{ id: string }>(UPDATE_SQL, [
          input.id,
          row.serviceTypeId,
          comparedWithId,
          body,
          input.savedAt,
        ])
      : await db.query<{ id: string }>(INSERT_SQL, [
          input.clientId,
          input.locale ?? 'en',
          row.serviceTypeId,
          comparedWithId,
          body,
        ]);
  } catch (error) {
    if (!isComparisonRefused(error) || comparedWithId === null) throw error;
    await db.query('rollback to savepoint qeeg_draft_write');
    const current = await comparedFrom(db, comparedWithId, {
      clientId: input.clientId,
      draftId: input.id ?? null,
      erased: false,
    });
    return c.json(
      {
        error: 'conflict',
        code: 'cannot_compare',
        // What the report is now. A withdraw is the one change the key
        // refuses that the read above could not have seen coming.
        reason: current.ok ? 'withdrawn' : current.reason,
        field: 'comparedWith.reportId',
        requestId,
      },
      409,
    );
  }
  const id = written.rows[0]?.id;
  if (!id) {
    const current = input.id ? await readReport(db, input.id) : null;
    if (current && current.status !== 'draft') {
      // Signed, or kept, since it was read: no longer a draft to save over.
      return c.json({ error: 'unprocessable', code: 'already_issued', requestId }, 422);
    }
    if (current) {
      // Still a draft, so what moved is the save itself: a newer one stands.
      return c.json({ error: 'conflict', code: 'stale_draft', requestId }, 409);
    }
    return c.json({ error: 'not_found', requestId }, 404);
  }

  // The maps it names are this report's own (brief L, "For PR 7"). Asked
  // after the write, inside its savepoint and under the row lock the write
  // took, so an upload or a removal on another tab waits for this answer
  // rather than slipping between the check and the commit.
  const unowned = await figuresNotOwned(db, id, comparedWithId, content);
  if (unowned !== null) {
    await db.query('rollback to savepoint qeeg_draft_write');
    if (unowned.status === 403) await logDraftRefused(db, input.clientId, unowned.body.code);
    return c.json({ ...unowned.body, requestId }, unowned.status);
  }

  const record = await readReport(db, id);
  if (!record) {
    return c.json({ error: 'not_found', requestId }, 404);
  }
  return c.json(
    QeegDraftResponse.parse({
      report: asRow(record),
      content: record.content,
      savedAt: record.saved_at,
    }),
    input.id ? 200 : 201,
  );
}

/**
 * A save of a second-language draft (docs/SPEC/reports-qeeg.md section 8,
 * point 3). **Only its own language's halves of typed text may differ from
 * the report it was made from**; everything else is that report's, rebuilt
 * from it on every save.
 *
 * **A save that tries to change anything else is refused by the field**
 * (`twin_fixed`), never answered with a rebuild that quietly drops what she
 * changed: a 200 that printed the first report's score where she set another
 * would tell her it was taken. The edition, what a follow-up is compared with
 * and the service are asked first, by name; the rest is the shape's to read
 * and then `twinChangeIn`'s to compare with the rebuild. The client's head,
 * the source, and a follow-up's earlier scores and pictures are written in
 * from the first report, as every save writes the server's parts, so they
 * cannot differ. What is written is the rebuild, which equals what was sent.
 */
async function saveTwin(
  c: Context<ApiEnv>,
  input: QeegDraftInput,
  sent: Readonly<Record<string, unknown>>,
  first: ReportRecord,
  locale: Locale,
  raw: unknown,
): Promise<Response> {
  const requestId = c.get('requestId');
  const fixed = (field: string) =>
    c.json({ error: 'unprocessable', code: 'twin_fixed', field, requestId }, 422);

  const from = validateQeegContent(first.content);
  if (!from.ok) {
    // The signed report no longer reads as a report: nothing can be made from it.
    return c.json(
      {
        error: 'unprocessable',
        code: 'invalid_content',
        field: from.refusals[0]?.path ?? '',
        requestId,
      },
      422,
    );
  }
  const firstContent = from.content;
  if (own(sent, 'edition') !== firstContent.edition) return fixed('edition');
  if (
    firstContent.edition === 'follow-up' &&
    own(own(sent, 'comparedWith'), 'reportId') !== firstContent.comparedWith.reportId
  ) {
    return fixed('comparedWith.reportId');
  }
  if (
    isRecord(raw) &&
    Object.hasOwn(raw, 'serviceTypeId') &&
    raw['serviceTypeId'] !== first.service_type_id
  ) {
    return fixed('serviceTypeId');
  }

  const checked = validateQeegContent(
    assembleDraft(sent, {
      subject: firstContent.subject,
      followUp: firstContent.edition === 'follow-up' ? firstContent : null,
    }),
  );
  if (!checked.ok) {
    return c.json(
      {
        error: 'bad_request',
        code: 'invalid_content',
        field: checked.refusals[0]?.path ?? '',
        refusals: checked.refusals,
        requestId,
      },
      400,
    );
  }
  const changed = twinChangeIn(firstContent, checked.content, locale);
  if (changed !== null) return fixed(changed);

  return writeDraft(c, input, checked.content, {
    comparedWithId: first.compared_with_id,
    serviceTypeId: first.service_type_id,
  });
}
