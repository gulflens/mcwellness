/**
 * The pictures uploaded to a draft that the draft does not place, which a
 * signature would otherwise freeze with it (docs/SPEC/reports-qeeg.md section
 * 9, point 5; review of the form's pictures, concern 3).
 *
 * **Why the issue route asks.** An upload is filed before the draft that
 * places it is saved, so a picture can be left on a draft and never placed:
 * the tab was closed, the save was discarded. Signing freezes every link a
 * report holds, and a picture it froze but never prints is a client's
 * document kept for no reason anyone could give. So the route refuses to sign
 * while any is left, and names them, and she places or removes each through
 * the form's list of pictures uploaded and not on the report. Nothing is
 * taken away behind her back.
 *
 * **Only her own uploads.** A borrowed link is the earlier report's picture,
 * frozen with that report already; the form does not list it and she has no
 * door to remove it, so a refusal over one would be a refusal she could not
 * answer.
 *
 * Pure: the content and the draft's links in, the figure ids out, sorted.
 */

import { figuresNamedIn } from './figuresNamed';
import type { QeegContent } from './types';

/** A picture's link to a draft, as `report_figure` holds it. */
export type FigureLink = {
  readonly figureId: string;
  /** Linked from an earlier report rather than uploaded to this one. */
  readonly borrowed: boolean;
};

export function ownLinksNotNamed(content: QeegContent, links: readonly FigureLink[]): string[] {
  const named = new Set(figuresNamedIn(content).map((figure) => figure.ref.figureId));
  return links
    .filter((link) => !link.borrowed && !named.has(link.figureId))
    .map((link) => link.figureId)
    .sort();
}
