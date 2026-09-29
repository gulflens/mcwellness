import type { Context } from 'hono';
import { isoDateIn } from '../../../domain/shared';
import {
  assembleDraft,
  routeOwnedIn,
  subjectFrom,
} from '../../../domain/reports/qeeg/draftRequest';
import { prefillFollowUp, type EarlierReport } from '../../../domain/reports/qeeg/prefill';
import { validateQeegContent } from '../../../domain/reports/qeeg/shape';
import { isRecord } from '../../../domain/reports/qeeg/text';
import type { QeegContent, QeegFollowUp } from '../../../domain/reports/qeeg/types';
import { isUuid } from '../billing/ids';
import { logRead } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { mayDraftReport } from './access';
import { practiceTimeZone } from './gather';
import { QeegDraftInput, QeegDraftResponse } from './schema';
import { asRow, readReport } from './source';

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
 * those parts, a calculated figure, or a count of sessions said to be
 * gathered, is refused by name (`routeOwnedIn`), and nothing is written.
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

/** The request's reason, when it gives one worth recording. */
function reasonOf(c: Context<ApiEnv>): string | null {
  const reason = (c.req.header('x-reason') ?? '').trim();
  return reason.length > 0 ? reason : null;
}

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
    return c.json({ error: 'forbidden', requestId }, 403);
  }
  if (reasonOf(c) === null) {
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
  }

  const found = await db.query<ClientRow>(CLIENT_SQL, [input.clientId]);
  const client = found.rows[0];
  if (!client) {
    // A client this person cannot reach is not there at all.
    return c.json({ error: 'not_found', requestId }, 404);
  }
  // The record was read, and its details are about to leave in the answer.
  await logRead(db, 'client', input.clientId, input.clientId);

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
      erased: client.status === 'erased',
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
  const subject = subjectFrom(
    {
      givenNameAr: client.given_name_ar,
      familyNameAr: client.family_name_ar,
      dateOfBirth: client.date_of_birth,
      sexAtBirth: client.sex_at_birth,
    },
    {
      recordedOn: typeof recordedOn === 'string' ? recordedOn : null,
      today: isoDateIn(now(), await practiceTimeZone(db)),
    },
  );
  const checked = validateQeegContent(assembleDraft(sent, { subject, followUp }));
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

  const body = JSON.stringify(checked.content);
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
          input.serviceTypeId,
          comparedWithId,
          body,
          input.savedAt,
        ])
      : await db.query<{ id: string }>(INSERT_SQL, [
          input.clientId,
          input.locale ?? 'en',
          input.serviceTypeId,
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
    if (input.id && (await readReport(db, input.id))) {
      // It is there and it is a draft, so what moved is the save itself.
      return c.json({ error: 'conflict', code: 'stale_draft', requestId }, 409);
    }
    return c.json({ error: 'not_found', requestId }, 404);
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
