import { z } from 'zod';
import { MAX_FILE_BYTES } from '../../../../domain/reports/qeeg/image/limits';
import { SavedAt } from '../schema';

/**
 * What the brain map's two doors take and answer
 * (docs/SPEC/reports-qeeg.md sections 9 and 14): `PUT /api/reports/:id/figures`
 * and `DELETE /api/reports/:id/figures/:figureId`.
 *
 * **The body is the picture**, raw, never JSON: an opaque 8-bit RGB PNG the
 * browser has already trimmed and flattened (section 9, point 2). What the
 * editor knows about it beside the bytes travels in the query — the
 * condition it was recorded under and its place among the maps — and the
 * digest in `X-Sha256`. The file's own name never crosses the door: the
 * practice's exports are named after the people in them.
 *
 * **A refusal of a picture carries a sentence**, because the practitioner is
 * the one who must act on it and the form shows it as it stands (section 9,
 * point 3: "refused with a sentence"). The console is English only, so the
 * sentences are English and live here, beside the codes they explain.
 */

export const FIGURE_PATH = /^\/api\/reports\/[^/]+\/figures$/;

/** The largest body the upload door reads: the cap of section 9, point 3. */
export const FIGURE_BODY_LIMIT_BYTES = MAX_FILE_BYTES;

/**
 * Sixty seconds (docs/CHANGE-REQUESTS/reports-02.md, request 3). Five
 * megabytes inside a minute asks about 0.7 Mbit/s of the link, which any
 * ordinary fixed or mobile connection clears; the ten seconds every other
 * route keeps would ask 4 Mbit/s all the way through.
 */
export const FIGURE_TIMEOUT_MS = 60_000;

export const FIGURE_CONDITIONS = ['eyes_open', 'eyes_closed'] as const;

export const FigureQuery = z
  .object({
    condition: z.enum(FIGURE_CONDITIONS).optional(),
    position: z.coerce.number().int().min(0).max(7).optional(),
  })
  .strict();

export const FigureDigest = z.string().regex(/^[0-9a-f]{64}$/);

export type FigureRefusalCode =
  | 'too_many_bytes'
  | 'too_wide'
  | 'too_tall'
  | 'too_many_pixels'
  | 'too_many_maps'
  | 'not_a_png'
  | 'not_rgb'
  | 'not_8_bit'
  | 'interlaced'
  | 'damaged';

/** One sentence for each refusal of a picture, as the form shows it. */
export const FIGURE_SENTENCES: Readonly<Record<FigureRefusalCode, string>> = Object.freeze({
  too_many_bytes:
    'This map is larger than 5 MB. Export it again at a smaller size; it is never shrunk here.',
  too_wide:
    'This map is wider than 4,096 pixels. Export it again at a smaller size; it is never shrunk here.',
  too_tall:
    'This map is taller than 4,096 pixels. Export it again at a smaller size; it is never shrunk here.',
  too_many_pixels:
    'This map has more than 12 million pixels. Export it again at a smaller size; it is never shrunk here.',
  too_many_maps: 'A report holds eight maps. Remove one before adding another.',
  not_a_png: 'This file is not a PNG picture. The form prepares each map as one before it is sent.',
  not_rgb:
    'This picture is not in plain colour without transparency. The form prepares each map as one before it is sent.',
  not_8_bit:
    'This picture is not 8 bits to a colour. The form prepares each map as one before it is sent.',
  interlaced:
    'This picture is interlaced. The form prepares each map as a plain one before it is sent.',
  damaged: 'This picture is damaged: its data does not match its size. Export it again.',
});

/** A picture as a report names it, and what the link adds. */
export const FigureOut = z.object({
  figureId: z.uuid(),
  sha256: FigureDigest,
  widthPx: z.number().int().min(1),
  heightPx: z.number().int().min(1),
  condition: z.enum(FIGURE_CONDITIONS).nullable(),
  position: z.number().int().nullable(),
  borrowed: z.boolean(),
});
export type FigureOut = z.infer<typeof FigureOut>;

/** A picture filed, and the stamp the editor's next save is made over (brief L, "For PR 7"). */
export const FigureFiledResponse = z.object({ figure: FigureOut, savedAt: SavedAt });
export type FigureFiledResponse = z.infer<typeof FigureFiledResponse>;

/** A picture removed, and the same stamp. */
export const FigureRemovedResponse = z.object({ removed: z.literal(true), savedAt: SavedAt });
export type FigureRemovedResponse = z.infer<typeof FigureRemovedResponse>;
