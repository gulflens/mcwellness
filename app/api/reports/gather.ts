import {
  gatherProgress,
  observationWords,
  type AssessmentRow,
  type EntitlementRow,
  type GoalRow,
  type ProgressNarrative,
  type ProgressReportContent,
  type RatingPair,
  type ReportLocale,
  type SessionReportContent,
  type VisitRow,
} from '../../../domain/reports';
import type { Db } from '../_middleware/request-context';

/**
 * Reading the record a progress report quotes, and handing it to
 * `gatherProgress` as data (docs/SPEC/reports-v1.md sections 6 and 8).
 *
 * **The brain maps are read through one query guarded at runtime.** The
 * `assessment` table belongs to the assessment stream's range (500–599) and
 * this database may not carry it: the two streams are built side by side, and
 * apply order across ranges is not fixed (docs/SPEC/OWNERSHIP.md). So the
 * query runs only when `to_regclass('public.assessment')` says the table is
 * there, its columns are the ones `docs/SPEC/assessment.md` section 6 names,
 * and its rows land in a local type of this module's own. **Nothing here
 * imports `domain/assessment`** — rule 3 forbids it, and a report quoting a
 * comparison is not the same thing as a report computing one.
 *
 * When the table is absent the comparison is empty and the report says nothing
 * about brain maps. That is the honest answer rather than a heading over a
 * hole.
 *
 * **The visits and the credits are asked the same question first, and that is
 * not decoration.** `session` (300–399) and `entitlement` (400–499) are other
 * streams' tables, on this database today and not this range's to assume, and
 * a route that queried them unguarded answered 500 on a database carrying
 * neither range — which is an ordinary state of affairs while the streams are
 * built side by side. Absent, there are no visits and no credits, which is the
 * same honest empty answer the brain maps give.
 *
 * `goal` is asked unguarded on purpose: it is the client record's own table
 * (100–199), and a database without that range has no client to report on.
 */

const VISITS_SQL =
  "select s.id, to_char(s.checked_in_at at time zone $2, 'YYYY-MM-DD') as on_day, " +
  's.signal_quality_score, s.telemetry ' +
  'from session s ' +
  "where s.tenant_id = app.current_tenant_id() and s.client_id = $1 and s.status = 'completed' " +
  'order by s.checked_in_at, s.id';

const ENTITLEMENTS_SQL =
  'select id, status::text as status from entitlement ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1';

const GOALS_SQL =
  'select id, description, status::text as status from goal ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1 order by is_primary desc, set_at, id';

/**
 * The brain maps, taking exactly the columns `docs/SPEC/assessment.md` section
 * 6 names. `derived` is the shape that stream declares; a figure without a
 * unit is skipped rather than paired with a guess.
 *
 * **Brain maps and nothing else.** A questionnaire is an assessment too, and
 * one landing in this list was the second half of a real defect: the
 * comparison takes the earliest and the latest of what it is given
 * (`compareBrainMaps`, domain/reports/gatherProgress.ts), and a questionnaire
 * at either end makes it a comparison between two different instruments,
 * which is refused — so a household with two brain maps and one questionnaire
 * read "fewer than two brain maps". The ribbon has the same trouble: its
 * hairline marks a brain map (docs/DESIGN-BRIEF.md section 5) and a
 * questionnaire is not one. `derived->>'kind'` is the assessment stream's own
 * declared discriminator (its `BrainMapPayload`), quoted rather than imported
 * like every other fact about that table in this file.
 */
const ASSESSMENTS_SQL =
  "select a.id, to_char(a.performed_at at time zone $2, 'YYYY-MM-DD') as on_day, " +
  'a.instrument, a.derived, a.reference_age_years, a.reference_sex ' +
  'from assessment a ' +
  'where a.tenant_id = app.current_tenant_id() and a.client_id = $1 ' +
  "  and a.derived->>'kind' = 'brain-map' " +
  '  and not exists (select 1 from assessment later where later.supersedes_id = a.id) ' +
  'order by a.performed_at, a.id';

type TelemetryChunk = { bands?: Record<string, unknown> };

/**
 * The bands a visit trained, summed across its run. The amplitudes go no
 * further than this: what leaves is which band was largest, which is a hue for
 * a slice (`dominantBand`). No threshold is read at all — there is no field on
 * any type in `domain/reports` to put one in.
 */
function bandsOf(telemetry: unknown): Record<string, number> {
  const chunks: TelemetryChunk[] = Array.isArray(telemetry) ? (telemetry as TelemetryChunk[]) : [];
  const totals: Record<string, number> = {};
  for (const chunk of chunks) {
    const bands = chunk?.bands;
    if (bands === null || typeof bands !== 'object') continue;
    for (const [band, value] of Object.entries(bands as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      totals[band] = (totals[band] ?? 0) + value;
    }
  }
  return totals;
}

/**
 * One figure the equipment's software reported, in the shape the assessment
 * stream declares for a brain map (`BandFigure`, docs/SPEC/assessment.md
 * section 5): the scalp site, the frequency band, the value and its unit.
 *
 * It was read here as `{ label, unit, value }` — a shape nothing writes — so
 * every figure of every brain map was skipped, every comparison came back
 * with no lines, and `compareBrainMaps` answered null, which the draft
 * editor says as "fewer than two brain maps of one kind". That was the whole
 * of docs/CHANGE-REQUESTS/qa-01.md item 3: a household with two maps on file
 * and a report that could not see either.
 */
type DerivedFigure = { site?: unknown; band?: unknown; unit?: unknown; value?: unknown };

/**
 * The words a figure is named and measured in, exactly as the comparison
 * screen names them (`BAND_LABELS` and `UNIT_SHORT`,
 * app/admin/assessments/copy.ts). `docs/SPEC/reports-v1.md` section 5 asks
 * for "the same figures ... the comparison view shows", so the two say one
 * thing; quoted rather than imported, because that file is another stream's
 * and a screen's copy is not a route's to depend on (OWNERSHIP.md rule 3 is
 * about `domain/`, and the same reasoning holds a route out of a component
 * folder).
 *
 * An unlisted band or unit is not renamed and not dropped: it is quoted as
 * the database holds it, which is honest and is what a figure the practice
 * starts recording tomorrow deserves.
 */
const BAND_WORDS: Record<string, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};

const UNIT_WORDS: Record<string, string> = {
  uV2: 'µV²',
  percent: '%',
  ratio: 'ratio',
  sd: 'SD',
  points: 'points',
};

function figuresOf(derived: unknown): AssessmentRow['figures'] {
  if (derived === null || typeof derived !== 'object') return [];
  const source = (derived as { figures?: unknown }).figures;
  if (!Array.isArray(source)) return [];
  const out: { label: string; labelAr: string | null; unit: string; value: number }[] = [];
  for (const figure of source as DerivedFigure[]) {
    if (
      typeof figure?.site !== 'string' ||
      typeof figure.band !== 'string' ||
      typeof figure.unit !== 'string' ||
      typeof figure.value !== 'number' ||
      !Number.isFinite(figure.value)
    ) {
      // A figure without its site, its band or its unit is not something to
      // compare; the assessment stream refuses one at its own edge and this
      // refuses to quote one.
      continue;
    }
    out.push({
      // The pair is what a comparison lines two maps up by (`figureKey`,
      // domain/assessment/shapes/brain-map.ts) and it is also what a reader
      // sees, so one string is both. `labelAr` is null on purpose: the site
      // is written in the international 10-20 system in every language, and
      // this repository holds no Arabic word for a band — inventing one in a
      // route is not the place, and the renderer falls back to the label it
      // has.
      label: `${figure.site} ${BAND_WORDS[figure.band] ?? figure.band}`,
      labelAr: null,
      unit: UNIT_WORDS[figure.unit] ?? figure.unit,
      value: figure.value,
    });
  }
  return out;
}

export type Gathered = {
  content: ProgressReportContent;
  /** True when the assessment table is on this database and was read. */
  brainMapsRead: boolean;
};

/** Whether a table another stream owns is on this database at all. */
async function tableExists(db: Db, name: string): Promise<boolean> {
  const found = await db.query<{ present: boolean }>(
    'select to_regclass($1) is not null as present',
    [name],
  );
  return found.rows[0]?.present === true;
}

export async function gatherForClient(
  db: Db,
  input: {
    clientId: string;
    coverage: { from: string; to: string };
    timeZone: string;
    narrative?: ProgressNarrative;
  },
): Promise<Gathered> {
  const [visitsPresent, entitlementsPresent, brainMapsRead] = await Promise.all([
    tableExists(db, 'public.session'),
    tableExists(db, 'public.entitlement'),
    tableExists(db, 'public.assessment'),
  ]);

  const [visits, entitlements, goals] = await Promise.all([
    visitsPresent
      ? db.query<{
          id: string;
          on_day: string;
          signal_quality_score: string | null;
          telemetry: unknown;
        }>(VISITS_SQL, [input.clientId, input.timeZone])
      : Promise.resolve({ rows: [] }),
    entitlementsPresent
      ? db.query<{ id: string; status: EntitlementRow['status'] }>(ENTITLEMENTS_SQL, [
          input.clientId,
        ])
      : Promise.resolve({ rows: [] }),
    db.query<{ id: string; description: string; status: string }>(GOALS_SQL, [input.clientId]),
  ]);

  let assessments: AssessmentRow[] = [];
  if (brainMapsRead) {
    const found = await db.query<{
      id: string;
      on_day: string;
      instrument: string;
      derived: unknown;
      reference_age_years: number | null;
      reference_sex: string | null;
    }>(ASSESSMENTS_SQL, [input.clientId, input.timeZone]);
    assessments = found.rows.map((row) => ({
      id: row.id,
      performedOn: row.on_day,
      instrument: row.instrument,
      figures: figuresOf(row.derived),
      referenceAgeYears: row.reference_age_years,
      referenceSex: row.reference_sex,
    }));
  }

  const visitRows: VisitRow[] = visits.rows.map((row) => ({
    id: row.id,
    on: row.on_day,
    // numeric(4,3) arrives as a string from pg; a report's figure must not
    // depend on which driver read it.
    signalQuality: row.signal_quality_score === null ? null : Number(row.signal_quality_score),
    bands: bandsOf(row.telemetry),
  }));

  const goalRows: GoalRow[] = goals.rows.map((row) => ({
    id: row.id,
    description: row.description,
    status: row.status,
  }));

  return {
    content: gatherProgress({
      visits: visitRows,
      entitlements: entitlements.rows,
      goals: goalRows,
      assessments,
      coverage: input.coverage,
      ...(input.narrative ? { narrative: input.narrative } : {}),
    }),
    brainMapsRead,
  };
}

/** The practice's own time zone, which every date rule is decided in. */
export async function practiceTimeZone(db: Db): Promise<string> {
  const found = await db.query<{ timezone: string }>(
    'select timezone from tenant where id = app.current_tenant_id()',
  );
  return found.rows[0]?.timezone ?? 'Asia/Dubai';
}

// --------------------------------------------------------------------------
// The session report's own source: one completed visit.
// --------------------------------------------------------------------------

/**
 * A visit a session report may be written about, as the picker shows it. Only
 * completed ones: a report follows a visit that happened.
 */
export type VisitChoice = {
  id: string;
  on: string;
  serviceName: string;
  practitionerName: string;
  durationMinutes: number | null;
};

const VISIT_COLUMNS =
  "s.id, to_char(s.checked_in_at at time zone $2, 'YYYY-MM-DD') as on_day, " +
  'st.name as service_name, st.name_ar as service_name_ar, st.rating_questions, ' +
  'u.display_name as practitioner_name, ' +
  'case when s.checked_out_at is null then null else ' +
  '  round(extract(epoch from (s.checked_out_at - s.checked_in_at)) / 60)::int end ' +
  '  as duration_min, ' +
  's.pre_rating, s.post_rating, s.observations ' +
  'from session s ' +
  'join service_type st on st.id = s.service_type_id and st.tenant_id = s.tenant_id ' +
  'join practitioner p on p.id = s.practitioner_id and p.tenant_id = s.tenant_id ' +
  'join app_user u on u.id = p.user_id and u.tenant_id = p.tenant_id ' +
  "where s.tenant_id = app.current_tenant_id() and s.client_id = $1 and s.status = 'completed'";

const VISIT_LIST_SQL = `select ${VISIT_COLUMNS} order by s.checked_in_at desc, s.id limit 50`;
const VISIT_ONE_SQL = `select ${VISIT_COLUMNS} and s.id = $3`;

/** The goal area a session report names: the client's own primary goal. */
const PRIMARY_GOAL_SQL =
  'select description from goal ' +
  'where tenant_id = app.current_tenant_id() and client_id = $1 and is_primary ' +
  "  and status = 'active' limit 1";

type VisitRecord = {
  id: string;
  on_day: string;
  service_name: string;
  service_name_ar: string | null;
  rating_questions: unknown;
  practitioner_name: string;
  duration_min: number | null;
  pre_rating: unknown;
  post_rating: unknown;
  observations: unknown;
};

/** `[{ key, value }]`, as the visit recorded it, read into a lookup. */
function answers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!Array.isArray(value)) return out;
  for (const answer of value as { key?: unknown; value?: unknown }[]) {
    if (typeof answer?.key !== 'string') continue;
    if (typeof answer.value !== 'number' || !Number.isFinite(answer.value)) continue;
    out[answer.key] = Math.trunc(answer.value);
  }
  return out;
}

/**
 * The before-and-after ratings, in the service's own words.
 *
 * The questions are the service type's (`rating_questions`, migration 901) and
 * the answers are keyed to them, so a label the practice rewords does not
 * change what an old answer meant. A question neither side answered is left
 * out rather than printed as two blanks.
 */
function ratingsOf(record: VisitRecord, locale: ReportLocale): RatingPair[] {
  const before = answers(record.pre_rating);
  const after = answers(record.post_rating);
  const questions = Array.isArray(record.rating_questions)
    ? (record.rating_questions as { key?: unknown; label_en?: unknown; label_ar?: unknown }[])
    : [];
  const pairs: RatingPair[] = [];
  for (const question of questions) {
    if (typeof question?.key !== 'string') continue;
    const label =
      locale === 'ar' && typeof question.label_ar === 'string'
        ? question.label_ar
        : typeof question.label_en === 'string'
          ? question.label_en
          : question.key;
    const one = before[question.key] ?? null;
    const two = after[question.key] ?? null;
    if (one === null && two === null) continue;
    pairs.push({
      key: question.key,
      label,
      labelAr: typeof question.label_ar === 'string' ? question.label_ar : null,
      before: one,
      after: two,
    });
  }
  return pairs;
}

/** What a session report says a person wrote, so it can be put back. */
export type SessionNarrative = { note: string; beforeNextVisit: string };

/** The completed visits a session report may be drafted from. */
export async function listVisits(
  db: Db,
  clientId: string,
  timeZone: string,
): Promise<VisitChoice[]> {
  if (!(await tableExists(db, 'public.session'))) return [];
  const found = await db.query<VisitRecord>(VISIT_LIST_SQL, [clientId, timeZone]);
  return found.rows.map((row) => ({
    id: row.id,
    on: row.on_day,
    serviceName: row.service_name,
    practitionerName: row.practitioner_name,
    durationMinutes: row.duration_min,
  }));
}

/**
 * One completed visit, as a session report quotes it (section 5).
 *
 * **Everything but the two written lines comes from the record**, for the
 * reason the progress report's figures do: a figure a practitioner could
 * retype is a figure that can disagree with the record (section 4.2).
 *
 * **Nothing about the protocol travels.** No electrode site, no band, no
 * threshold: `telemetry` is not read here at all, and the session shape has no
 * field to put one in.
 *
 * Answers null where the visit is not one this report can be written about —
 * another client's, not completed, or on a database without the session
 * range at all.
 */
export async function gatherSession(
  db: Db,
  input: {
    clientId: string;
    sessionId: string;
    timeZone: string;
    locale: ReportLocale;
    narrative?: SessionNarrative;
  },
): Promise<SessionReportContent | null> {
  if (!(await tableExists(db, 'public.session'))) return null;
  const found = await db.query<VisitRecord>(VISIT_ONE_SQL, [
    input.clientId,
    input.timeZone,
    input.sessionId,
  ]);
  const row = found.rows[0];
  if (!row) return null;

  const observations = (row.observations ?? {}) as {
    chips?: unknown;
    tolerance?: unknown;
    engagement?: unknown;
  };
  const goal = await db.query<{ description: string }>(PRIMARY_GOAL_SQL, [input.clientId]);

  return {
    kind: 'session',
    sessionId: row.id,
    visitDate: row.on_day,
    serviceName: row.service_name,
    serviceNameAr: row.service_name_ar,
    practitionerName: row.practitioner_name,
    durationMinutes: row.duration_min,
    // The visit record names no goal of its own, and a report may not invent
    // one, so this is the client's own primary goal — the nearest fact the
    // record holds — or nothing at all.
    goalArea: goal.rows[0]?.description ?? null,
    ratings: ratingsOf(row, input.locale),
    observationChips: observationWords(
      Array.isArray(observations.chips) ? observations.chips : [],
      input.locale,
    ),
    tolerance: typeof observations.tolerance === 'number' ? observations.tolerance : null,
    engagement: typeof observations.engagement === 'number' ? observations.engagement : null,
    note: input.narrative?.note ?? '',
    beforeNextVisit: input.narrative?.beforeNextVisit ?? '',
  };
}
