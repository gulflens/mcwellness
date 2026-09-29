/**
 * The shape a stored brain-map report is held to, in either edition.
 *
 * **Strict, and refused by name.** Every object here is `.strict()`, as the
 * other report kinds are (`domain/reports/shapes`): a field the renderer never
 * reads would be a promise the document does not keep, so an unknown key is
 * refused and named, at whatever depth it sits. A refusal carries the dotted
 * path to the field, because a draft that will not save is a practitioner
 * staring at a form, and "invalid" tells her nothing.
 *
 * **`null` is "not chosen yet".** An unfinished draft has to save, so nothing
 * a practitioner chooses is required here. What a report needs before it can
 * be signed is `complete.ts`'s question, asked separately.
 *
 * **Each edition validates against its own lists.** A first report's band is
 * increased, reduced or within normal limits; a follow-up's band has improved,
 * held or moved further. The two lists share no name, and each edition's shape
 * knows only its own, so a choice made in one can never be read as the other.
 *
 * **No figure is read off a picture.** A change figure says whether it was
 * typed or calculated, a calculated one carries what it was calculated from,
 * and only a measure the app records (`CALCULABLE_MEASURES`) can have one. A
 * headline tile is always the practitioner's own figure.
 */

import { z } from 'zod';
import {
  APPROACH_IDS,
  BAND_CHANGES,
  BAND_IDS,
  BENEFIT_IDS,
  CALCULABLE_MEASURES,
  CONNECTIVITY_CHANGES,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  INITIAL_BAND_LEVELS,
  INITIAL_CONNECTIVITY_LEVELS,
  MEASURE_IDS,
  NEXT_STAGE_IDS,
  RECOMMENDATION_IDS,
  REGION_IDS,
} from './catalogue/ids';
import {
  CONDITIONS,
  EYES,
  HANDEDNESS,
  IMPORT_NOTE_CODES,
  LIMITS,
  SEXES,
  STAGES,
  type QeegContent,
  type QeegFollowUp,
  type QeegInitial,
} from './types';
import { isRealDay } from './text';

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[0-9a-f]{64}$/;

const day = z
  .string()
  .regex(ISO_DATE, 'A date is written YYYY-MM-DD.')
  .refine(isRealDay, 'That day is not in the calendar, or not from 2000 to 2100.');

const whole = (least: number, most: number) => z.number().int().min(least).max(most);

const scoreOrNull = whole(0, 10).nullable();

/** A list chosen from `ids`, with nothing in it twice. */
function uniqueOf<const T extends readonly [string, ...string[]]>(ids: T) {
  return z.array(z.enum(ids)).superRefine((list, ctx) => {
    list.forEach((value, index) => {
      if (list.indexOf(value) < index) {
        ctx.addIssue({ code: 'custom', path: [index], message: `${value} is chosen twice.` });
      }
    });
  });
}

const regions = uniqueOf(REGION_IDS);

/** Typed once in English, with an optional Arabic, each held to `most`. */
const bilingual = (most: number) =>
  z.object({ en: z.string().max(most), ar: z.string().max(most).nullable() }).strict();

/** A label she added: never empty in English. */
const labelText = z
  .object({
    en: z.string().trim().min(1, 'A label she adds is never empty.').max(LIMITS.label),
    ar: z.string().max(LIMITS.label).nullable(),
  })
  .strict();

const mark = z
  .object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    bold: z.literal(true).optional(),
    underline: z.literal(true).optional(),
  })
  .strict();

const richText = (most: number) =>
  z
    .object({ text: z.string().max(most), marks: z.array(mark).max(LIMITS.marks) })
    .strict()
    .superRefine((rich, ctx) => {
      let end = 0;
      rich.marks.forEach((each, index) => {
        const path = ['marks', index];
        if (!(each.from < each.to && each.to <= rich.text.length)) {
          ctx.addIssue({ code: 'custom', path, message: 'A mark lies inside the text it marks.' });
        } else if (each.from < end) {
          ctx.addIssue({ code: 'custom', path, message: 'Marks are in order and never overlap.' });
        }
        if (!each.bold && !each.underline) {
          ctx.addIssue({ code: 'custom', path, message: 'A mark is bold, underlined, or both.' });
        }
        end = Math.max(end, each.to);
      });
    });

const bilingualRich = (most: number) =>
  z.object({ en: richText(most), ar: richText(most).nullable() }).strict();

/** The keys the app makes for an ordered list's items: `c0`, `map-0`, `t1`. */
const ORDERED_KEY = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * A key the app would make, and not one every object answers to.
 * `constructor` fits the pattern, so it is refused by name besides.
 */
const isOrderedKey = (key: string) => ORDERED_KEY.test(key) && !(key in Object.prototype);

/**
 * Every key of an ordered list, read from the input AS IT WAS SENT. A record
 * in zod passes over a key named after the prototype, so its value would be
 * neither read nor handed back; looking at the raw keys first is what lets
 * such a key be refused by name, with `constructor` and `toString` beside it.
 */
function keysAreTheApps(input: unknown, ctx: z.core.$RefinementCtx): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;
  for (const key of Object.keys(input)) {
    if (!isOrderedKey(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'An item is kept under a short lower-case key the app makes.',
      });
    }
  }
  return input;
}

/**
 * A list of typed things kept in order without being an array: each item
 * under its own key, with a place from 0 to n-1, none repeated.
 */
function ordered<const F extends z.core.$ZodLooseShape>(fields: F, most: number) {
  return z.preprocess(
    keysAreTheApps,
    z
      .record(
        z.string().refine(isOrderedKey),
        z.object({ ...fields, position: z.number().int() }).strict(),
      )
      .superRefine((items, ctx) => {
        const keys = Object.keys(items);
        if (keys.length > most) {
          ctx.addIssue({ code: 'custom', path: [], message: `At most ${most} may be kept here.` });
        }
        checkPositions(items as Readonly<Record<string, { position: number }>>, ctx);
      }),
  );
}

/** Places run from 0 with no gap and no repeat. Refused at the place that breaks it. */
function checkPositions(
  items: Readonly<Record<string, { position: number } | undefined>>,
  ctx: z.core.$RefinementCtx,
) {
  const present = Object.entries(items).filter(
    (entry): entry is [string, { position: number }] => entry[1] !== undefined,
  );
  const seen = new Set<number>();
  for (const [key, item] of present) {
    const { position } = item;
    if (position < 0 || position >= present.length || seen.has(position)) {
      ctx.addIssue({
        code: 'custom',
        path: [key, 'position'],
        message: 'Places run from 0 with no gap and no repeat.',
      });
    }
    seen.add(position);
  }
}

const customItem = {
  label: labelText,
  note: bilingual(LIMITS.note).nullable(),
  chosen: z.boolean(),
};

function picked<const T extends readonly [string, ...string[]]>(ids: T) {
  return z
    .object({ chosen: uniqueOf(ids), custom: ordered(customItem, LIMITS.customPerList) })
    .strict();
}

const figureFields = {
  figureId: z.uuid(),
  sha256: z.string().regex(SHA256, 'A digest is 64 lower-case hexadecimal characters.'),
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
};

const figureRef = z.object(figureFields).strict();

const mapFields = {
  ...figureFields,
  condition: z.enum(CONDITIONS).nullable(),
  caption: bilingual(LIMITS.caption).nullable(),
};

const provenance = z.discriminatedUnion('origin', [
  z.object({ origin: z.literal('app') }).strict(),
  z
    .object({
      origin: z.literal('legacy_tool'),
      format: z.literal('qeeg.json/1'),
      sourceSha256: z.string().regex(SHA256),
      notes: z
        .array(
          z
            .object({ code: z.enum(IMPORT_NOTE_CODES), at: z.string().max(200).nullable() })
            .strict(),
        )
        .max(500),
      asPrinted: z
        .object({
          signerName: z.string().max(LIMITS.label).nullable(),
          signerRole: z.string().max(LIMITS.label).nullable(),
        })
        .strict(),
    })
    .strict(),
]);

const subject = z
  .object({
    nameAr: z.string().max(LIMITS.label).nullable(),
    ageYears: whole(0, 130).nullable(),
    sex: z.enum(SEXES).nullable(),
  })
  .strict();

const recording = z
  .object({
    recordedOn: day.nullable(),
    eyes: z.enum(EYES).nullable(),
    handedness: z.enum(HANDEDNESS).nullable(),
  })
  .strict();

const sessions = whole(1, LIMITS.sessionsMost).nullable();

/** One entry for every key of a list, each of the same shape. */
function everyOf<const K extends readonly string[], S extends z.ZodType>(keys: K, shape: S) {
  return z
    .object(Object.fromEntries(keys.map((key) => [key, shape])) as { [P in K[number]]: S })
    .strict();
}

const common = {
  kind: z.literal('qeeg'),
  schema: z.literal(1),
  wording: z.literal(1),
  provenance,
  subject,
  recording,
  findings: picked(FINDING_IDS),
  focus: picked(FOCUS_IDS),
  maps: ordered(mapFields, LIMITS.maps),
  recommendations: picked(RECOMMENDATION_IDS),
  summary: bilingualRich(LIMITS.summary),
  benefits: picked(BENEFIT_IDS),
};

const score = z
  .object({ score: scoreOrNull, evidence: bilingual(LIMITS.evidence).nullable() })
  .strict();

// ---------------------------------------------------------------------------
// A first report
// ---------------------------------------------------------------------------

const initialLevel = <const T extends readonly [string, ...string[]]>(levels: T) =>
  z.object({ level: z.enum(levels).nullable(), regions }).strict();

const initialShape = z
  .object({
    ...common,
    edition: z.literal('initial'),
    stage: z.enum(STAGES),
    bands: everyOf(BAND_IDS, initialLevel(INITIAL_BAND_LEVELS)),
    connectivity: z
      .object({
        connectivity: initialLevel(INITIAL_CONNECTIVITY_LEVELS.connectivity),
        asymmetry: initialLevel(INITIAL_CONNECTIVITY_LEVELS.asymmetry),
        phase_lag: initialLevel(INITIAL_CONNECTIVITY_LEVELS.phase_lag),
      })
      .strict(),
    dashboard: everyOf(DIMENSION_IDS, score),
    plan: z.object({ sessions, approach: z.enum(APPROACH_IDS).nullable() }).strict(),
  })
  .strict()
  .superRefine((content, ctx) => {
    // The old tool had only the first report's lists, so a report brought in
    // from it is a first report whatever the practitioner called it.
    if (content.stage !== 'initial' && content.provenance.origin !== 'legacy_tool') {
      ctx.addIssue({
        code: 'custom',
        path: ['stage'],
        message: 'A first report is at the initial stage.',
      });
    }
  });

// ---------------------------------------------------------------------------
// A follow-up
// ---------------------------------------------------------------------------

const basis = z
  .object({
    earlierAssessmentId: z.uuid(),
    laterAssessmentId: z.uuid(),
    unit: z.literal('uV2'),
    sitesPaired: z.number().int().min(1),
  })
  .strict();

/** The top of a range is above its bottom. */
function rangeRises(figure: { low: number; high: number | null }, ctx: z.core.$RefinementCtx) {
  if (figure.high !== null && figure.high <= figure.low) {
    ctx.addIssue({
      code: 'custom',
      path: ['high'],
      message: 'The top of a range is above its bottom.',
    });
  }
}

const percentFields = {
  kind: z.literal('percent'),
  direction: z.enum(['increase', 'decrease']),
  low: whole(1, 100),
  high: z.number().int().max(100).nullable(),
};

const typedFields = { source: z.literal('typed'), basis: z.null() };
const calculatedFields = { source: z.literal('calculated'), basis };

/** Her own estimate: it has nothing it was calculated from. */
const typedFigure = z.discriminatedUnion('kind', [
  z
    .object({ ...percentFields, ...typedFields })
    .strict()
    .superRefine(rangeRises),
  z.object({ kind: z.literal('no_appreciable_change'), ...typedFields }).strict(),
]);

/** Arithmetic on two recorded assessments, which it names. */
const calculatedFigure = z.discriminatedUnion('kind', [
  z
    .object({ ...percentFields, ...calculatedFields })
    .strict()
    .superRefine(rangeRises),
  z.object({ kind: z.literal('no_appreciable_change'), ...calculatedFields }).strict(),
]);

/**
 * Where a figure came from and what it was calculated from are one fact, so
 * a calculated figure with no basis, or a typed one with a basis, is refused
 * at `basis`.
 */
const changeFigure = z.discriminatedUnion('source', [typedFigure, calculatedFigure]);

const tileFields = {
  // A headline is always hers: a calculated figure is refused at `source`.
  figure: typedFigure,
  caption: bilingual(LIMITS.caption),
};

const changeRow = z
  .object({
    position: z.number().int(),
    eyesOpen: changeFigure.nullable(),
    eyesClosed: changeFigure.nullable(),
  })
  .strict();

const CALCULABLE: ReadonlySet<string> = new Set(CALCULABLE_MEASURES);

const table = z
  .object(
    Object.fromEntries(MEASURE_IDS.map((id) => [id, changeRow.optional()])) as {
      [P in (typeof MEASURE_IDS)[number]]: z.ZodOptional<typeof changeRow>;
    },
  )
  .strict()
  .superRefine((rows, ctx) => {
    checkPositions(rows, ctx);
    for (const [measure, row] of Object.entries(rows)) {
      if (!row || CALCULABLE.has(measure)) continue;
      for (const condition of ['eyesOpen', 'eyesClosed'] as const) {
        if (row[condition]?.source === 'calculated') {
          ctx.addIssue({
            code: 'custom',
            path: [measure, condition, 'source'],
            message: 'The app records no figure for this measure to calculate from.',
          });
        }
      }
    }
  });

const pair = z.object({ earlier: figureRef.nullable(), later: figureRef.nullable() }).strict();

const changeSection = z
  .object({
    tiles: ordered(tileFields, LIMITS.tiles),
    sessionsCompleted: z
      .object({ count: whole(1, LIMITS.sessionsMost), source: z.enum(['gathered', 'typed']) })
      .strict()
      .nullable(),
    pairs: z.object({ eyes_open: pair, eyes_closed: pair }).strict(),
    table,
    summary: bilingualRich(LIMITS.summary),
  })
  .strict();

/**
 * A report this app signed has a printed reference; a past record from the
 * old tool has none. Which it is decides whether `reference` may be null.
 */
const comparedWithFields = {
  reportId: z.uuid(),
  recordedOn: day,
  relation: z.enum(['initial', 'previous']),
};

const comparedWith = z.discriminatedUnion('origin', [
  z
    .object({
      ...comparedWithFields,
      origin: z.literal('issued'),
      reference: z.string().trim().min(1).max(40),
    })
    .strict(),
  z.object({ ...comparedWithFields, origin: z.literal('imported'), reference: z.null() }).strict(),
]);

const followUpChange = <const T extends readonly [string, ...string[]]>(changes: T) =>
  z.object({ change: z.enum(changes).nullable(), regions }).strict();

const followUpShape = z
  .object({
    ...common,
    edition: z.literal('follow-up'),
    stage: z.enum(['follow_up', 'final']),
    // Always written in this app: the old tool had only a first report's
    // lists, and a past record is frozen, so none is ever made a follow-up.
    provenance: z.object({ origin: z.literal('app') }).strict(),
    comparedWith,
    bands: everyOf(BAND_IDS, followUpChange(BAND_CHANGES)),
    connectivity: everyOf(
      ['connectivity', 'asymmetry', 'phase_lag'] as const,
      followUpChange(CONNECTIVITY_CHANGES),
    ),
    dashboard: everyOf(
      DIMENSION_IDS,
      z
        .object({
          score: scoreOrNull,
          evidence: bilingual(LIMITS.evidence).nullable(),
          earlierScore: scoreOrNull,
        })
        .strict(),
    ),
    change: changeSection,
    plan: z.object({ sessions, next: z.enum(NEXT_STAGE_IDS).nullable() }).strict(),
  })
  .strict();

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

export const QeegInitialShape: z.ZodType<QeegInitial> = initialShape;
export const QeegFollowUpShape: z.ZodType<QeegFollowUp> = followUpShape;
export const QeegContentShape: z.ZodType<QeegContent> = z.discriminatedUnion('edition', [
  initialShape,
  followUpShape,
]);

export type ShapeRefusal = { path: string; reason: string };

/** Every refusal, each naming its field by a dotted path. */
export function validateQeegContent(
  input: unknown,
): { ok: true; content: QeegContent } | { ok: false; refusals: ShapeRefusal[] } {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, refusals: [{ path: '', reason: 'A report body is a set of fields.' }] };
  }
  const parsed = QeegContentShape.safeParse(input);
  if (parsed.success) return { ok: true, content: parsed.data };

  const refusals: ShapeRefusal[] = [];
  for (const issue of parsed.error.issues) {
    const path = issue.path.map(String);
    if (issue.code === 'unrecognized_keys') {
      // A field the shape does not know has no path of its own: it is a key
      // on the object being read, so it is named from the issue's own list.
      for (const key of issue.keys) {
        refusals.push({
          path: [...path, key].join('.'),
          reason: 'A report body carries only the fields its edition declares.',
        });
      }
    } else {
      refusals.push({ path: path.join('.'), reason: issue.message });
    }
  }
  return { ok: false, refusals };
}
