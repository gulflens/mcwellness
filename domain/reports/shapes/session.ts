import { z } from 'zod';

/**
 * The declared shape of a session report's body (docs/SPEC/reports-v1.md
 * sections 5 and 6): what the practice writes into `report.content`, and what
 * the PDF is rendered from.
 *
 * **Declared here rather than inferred at the edge**, because `content` is
 * what a report is re-rendered from years later. A field this shape does not
 * know is refused with its own name (`validateContent`), so a draft can never
 * carry something the renderer will silently drop.
 *
 * **What is deliberately absent.** No electrode site, no band, no threshold,
 * no protocol name (section 5). The session report says what was delivered,
 * to whom, by whom, how the client was before and after, what the practitioner
 * observed and what to expect next; the training's own settings are the
 * practice's and mean nothing to a household. There is no field here to put
 * one in, which is a stronger rule than asking a screen not to.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A short structured label: a chip, a status, a service's name. */
const label = (max: number) => z.string().trim().min(1).max(max);

/** A paragraph a person wrote. Long enough for a page, capped so a page ends. */
const narrative = (max: number) => z.string().max(max);

export const RatingPairShape = z
  .object({
    key: z.string().trim().min(1).max(64),
    label: label(120),
    labelAr: label(120).nullable(),
    before: z.number().int().min(0).max(10).nullable(),
    after: z.number().int().min(0).max(10).nullable(),
  })
  .strict();

export const SessionReportShape = z
  .object({
    kind: z.literal('session'),
    visitDate: z.string().regex(ISO_DATE),
    serviceName: label(120),
    serviceNameAr: label(120).nullable(),
    practitionerName: label(120),
    durationMinutes: z.number().int().min(1).max(600).nullable(),
    goalArea: label(200).nullable(),
    ratings: z.array(RatingPairShape).max(20),
    /**
     * The chips the practitioner ticked, already in words. Keys are the
     * session module's; a household reads sentences, so the words travel and
     * the keys stay behind.
     */
    observationChips: z.array(label(120)).max(20),
    tolerance: z.number().int().min(0).max(10).nullable(),
    engagement: z.number().int().min(0).max(10).nullable(),
    note: narrative(2000),
    beforeNextVisit: narrative(2000),
  })
  .strict();

export type SessionReportShape = z.infer<typeof SessionReportShape>;
