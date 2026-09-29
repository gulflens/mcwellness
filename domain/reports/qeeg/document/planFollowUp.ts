/**
 * How tall the maps of a follow-up's page of what has changed are drawn, so
 * that the page fits one sheet when it can (plan note N7, "Follow-up
 * section").
 *
 * **Why the maps give way.** Everything else on the page has the height its
 * words give it: the headline tiles, the table, her summary. The before-and-
 * after pairs are pictures, and a picture can be drawn smaller. So the room
 * the page has, less what everything else takes with its gaps, is shared
 * equally between the rows of maps, from a least of `CHANGE.mapLeast` to a
 * preferred `CHANGE.mapPreferred`.
 *
 * **When it cannot.** Below the least a map is too small to read, and the
 * page takes a second sheet whatever the maps are; so they are drawn at the
 * preferred height, and the page breaks between whole pairs and whole rows
 * (a pair and a row are never split). `onePage` says which it was.
 *
 * **The gaps are the pages' own.** The parts are stacked as `paginate`
 * stacks them (`reflow`): a section's top margin lifted, margins collapsed,
 * the first part at the top. Each part says how many rows of maps it holds,
 * and its `height` is its height with none.
 *
 * Pure plain arithmetic, as `paginate.ts` is: no font and no picture.
 */

import { CHANGE } from './geometry';
import { finite } from './metrics';
import { pageBottom, reflow } from './paginate';
import type { Flow, Limits } from './paginate';

export type PlanPart = Flow & {
  /** How many rows of maps the part holds; its `height` is taken without them. */
  readonly mapRows: number;
};

export type FollowUpPlan = {
  /** The height each map of a pair is drawn in. */
  readonly mapHeight: number;
  /** Whether the page fits one sheet with its maps at that height. */
  readonly onePage: boolean;
};

function checked(parts: readonly PlanPart[]): void {
  for (const part of parts) {
    finite('planFollowUp', 'height', part.height);
    if (part.height < 0) {
      throw new RangeError(
        `planFollowUp needs a height of zero or more, and was given ${part.height}.`,
      );
    }
    if (!Number.isInteger(part.mapRows) || part.mapRows < 0) {
      throw new RangeError(
        `planFollowUp needs a count of map rows that is a whole number of 0 or more, and was given ${part.mapRows}.`,
      );
    }
  }
}

export function planFollowUp(parts: readonly PlanPart[], limits: Limits): FollowUpPlan {
  checked(parts);
  const rows = parts.reduce((sum, part) => sum + part.mapRows, 0);
  const without = pageBottom(reflow(parts, (part) => part.height, new Map(), limits));
  if (rows === 0) {
    return { mapHeight: CHANGE.mapPreferred, onePage: without <= limits.bodyHeight };
  }
  const shared = (limits.bodyHeight - without) / rows;
  if (shared >= CHANGE.mapPreferred) return { mapHeight: CHANGE.mapPreferred, onePage: true };
  if (shared >= CHANGE.mapLeast) return { mapHeight: shared, onePage: true };
  return { mapHeight: CHANGE.mapPreferred, onePage: false };
}
