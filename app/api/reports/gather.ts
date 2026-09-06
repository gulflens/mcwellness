import {
  gatherProgress,
  type AssessmentRow,
  type EntitlementRow,
  type GoalRow,
  type ProgressNarrative,
  type ProgressReportContent,
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
 */
const ASSESSMENTS_SQL =
  "select a.id, to_char(a.performed_at at time zone $2, 'YYYY-MM-DD') as on_day, " +
  'a.instrument, a.derived, a.reference_age_years, a.reference_sex ' +
  'from assessment a ' +
  'where a.tenant_id = app.current_tenant_id() and a.client_id = $1 ' +
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

/** One figure the equipment's software reported, as the report quotes it. */
type DerivedFigure = { label?: unknown; labelAr?: unknown; unit?: unknown; value?: unknown };

function figuresOf(derived: unknown): AssessmentRow['figures'] {
  if (derived === null || typeof derived !== 'object') return [];
  const source = (derived as { figures?: unknown }).figures;
  if (!Array.isArray(source)) return [];
  const out: { label: string; labelAr: string | null; unit: string; value: number }[] = [];
  for (const figure of source as DerivedFigure[]) {
    if (
      typeof figure?.label !== 'string' ||
      typeof figure.unit !== 'string' ||
      typeof figure.value !== 'number' ||
      !Number.isFinite(figure.value)
    ) {
      // A figure without its unit is not something to compare; the assessment
      // stream refuses one at its own edge and this refuses to quote one.
      continue;
    }
    out.push({
      label: figure.label,
      labelAr: typeof figure.labelAr === 'string' ? figure.labelAr : null,
      unit: figure.unit,
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
