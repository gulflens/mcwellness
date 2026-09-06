import { z } from 'zod';
import { BAND_KEYS } from '../types';

/**
 * The declared shape of a progress report's body (docs/SPEC/reports-v1.md
 * sections 5 and 6).
 *
 * **The comparison is quoted, never computed here.** The figures come from the
 * assessment stream's rows as data (`gatherProgress`), with the same "not a
 * diagnosis" sentence the comparison view carries; nothing in this shape can
 * hold a word attached to a figure, because `docs/SPEC/assessment.md` refuses
 * to store one and a report may not invent one.
 *
 * **The ribbon is data, not a picture.** One slice per completed session with
 * its quality and its dominant band, a mark where a brain map was taken, and
 * the count of sessions still to come. The renderer draws it; two readers of
 * the same row draw the same figure.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const label = (max: number) => z.string().trim().min(1).max(max);
const narrative = (max: number) => z.string().max(max);

export const RibbonSliceShape = z
  .object({
    index: z.number().int().min(1),
    /**
     * The visit's `signal_quality_score`, 0 to 1. Null where the visit
     * recorded none — an ordinary state of an early record, and a slice at the
     * floor rather than a gap in the strip.
     */
    quality: z.number().min(0).max(1).nullable(),
    band: z.enum(BAND_KEYS).nullable(),
    mapMark: z.boolean(),
  })
  .strict();

export const RibbonShape = z
  .object({
    slices: z.array(RibbonSliceShape).max(200),
    remaining: z.number().int().min(0).max(200),
  })
  .strict();

export const GoalLineShape = z
  .object({
    /**
     * The goal's own id, carried in the body beside the assessment ids the
     * comparison already carries. It is what the practitioner's line about
     * this goal is paired back to when a draft is saved: paired by position, a
     * goal added between the gathering and the save moved every line down one
     * and put a sentence about sleep beside a goal about school, silently.
     */
    id: z.uuid(),
    description: narrative(500),
    status: label(40),
    movement: narrative(1000),
  })
  .strict();

export const ComparisonLineShape = z
  .object({
    label: label(120),
    labelAr: label(120).nullable(),
    unit: label(40),
    earlier: z.number(),
    later: z.number(),
    difference: z.number(),
  })
  .strict();

export const BrainMapComparisonShape = z
  .object({
    instrument: label(80),
    earlierOn: z.string().regex(ISO_DATE),
    laterOn: z.string().regex(ISO_DATE),
    earlierAssessmentId: z.uuid(),
    laterAssessmentId: z.uuid(),
    referenceAgeYears: z.number().int().min(0).max(120).nullable(),
    referenceSex: label(20).nullable(),
    lines: z.array(ComparisonLineShape).max(100),
  })
  .strict();

export const ProgressReportShape = z
  .object({
    kind: z.literal('progress'),
    coverageFrom: z.string().regex(ISO_DATE),
    coverageTo: z.string().regex(ISO_DATE),
    sessionsDelivered: z.number().int().min(0).max(500),
    sessionsEntitled: z.number().int().min(0).max(500),
    goals: z.array(GoalLineShape).max(20),
    ribbon: RibbonShape,
    comparison: BrainMapComparisonShape.nullable(),
    summary: narrative(4000),
    suggestion: narrative(2000),
  })
  .strict()
  .refine((value) => value.coverageFrom <= value.coverageTo, {
    path: ['coverageTo'],
    message: 'The coverage ends before it begins.',
  });

export type ProgressReportShape = z.infer<typeof ProgressReportShape>;
