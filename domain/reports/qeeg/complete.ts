/**
 * What a brain-map report still needs before it can be signed.
 *
 * **Separate from the shape, on purpose.** `shape.ts` accepts an unfinished
 * draft, because a draft has to save. This file asks the other question: is
 * there anything a household would find missing on the page? The form shows
 * the answer as a list, and the issue route refuses to sign while the list
 * has anything in it.
 *
 * **Names, never words.** Each thing missing is named by the wording key of
 * the heading it sits under and the wording key of what it is, so the form
 * can say both in whichever language it is showing, through `phrase`, and a
 * test can hold the list exactly.
 *
 * **What counts as done for a band or a kind of connectivity.** A sentence about a band
 * names the regions it involves, so a level with no region, or a region with
 * no level, is half a sentence. The exceptions are the choices that need no
 * place named: a band within normal limits on a first report, and on a
 * follow-up anything unchanged or now within normal limits. Connectivity on a
 * first report always names its regions, as the tool this was rebuilt from
 * required.
 *
 * **What is not asked.** Sex may be unknown, and the report then prints no
 * line for it. Every figure on a follow-up's page of what has changed is
 * optional, so that page asks for nothing.
 */

import {
  BAND_IDS,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  type BandId,
  type ConnectivityId,
} from './catalogue/ids';
import { isEmpty } from './text';
import type { Missing, Picked, QeegContent, Regions } from './types';

/** A follow-up choice that needs no region named. */
const NEEDS_NO_REGION: ReadonlySet<string> = new Set(['unchanged', 'now_within_normal_limits']);

/** Ticked from the list, or added and ticked. An added item left unticked does not count. */
function anyPicked(picked: Picked<string>): boolean {
  return picked.chosen.length > 0 || Object.values(picked.custom).some((item) => item.chosen);
}

function choiceIsComplete(choice: string | null, regions: Regions, exempt: boolean): boolean {
  if (choice === null) return false;
  return exempt || regions.length > 0;
}

export function bandIsComplete(content: QeegContent, band: BandId): boolean {
  if (content.edition === 'initial') {
    const { level, regions } = content.bands[band];
    return choiceIsComplete(level, regions, level === 'within_normal_limits');
  }
  const { change, regions } = content.bands[band];
  return choiceIsComplete(change, regions, change !== null && NEEDS_NO_REGION.has(change));
}

export function connectivityIsComplete(content: QeegContent, id: ConnectivityId): boolean {
  if (content.edition === 'initial') {
    const { level, regions } = content.connectivity[id];
    return choiceIsComplete(level, regions, false);
  }
  const { change, regions } = content.connectivity[id];
  return choiceIsComplete(change, regions, change !== null && NEEDS_NO_REGION.has(change));
}

/** Everything still needed before signing, in the order the form shows it. */
export function missingForIssue(content: QeegContent): Missing[] {
  const missing: Missing[] = [];
  const need = (present: boolean, section: string, what: string) => {
    if (!present) missing.push({ section, what });
  };

  need(content.recording.recordedOn !== null, 'heading.recording', 'label.date');
  need(content.recording.eyes !== null, 'heading.client', 'label.eyes');
  need(content.recording.handedness !== null, 'heading.client', 'label.handedness');
  // The age comes from the client's record, which has no date of birth to work it from.
  need(content.subject.ageYears !== null, 'heading.client', 'label.age');
  need(anyPicked(content.findings), 'heading.findings', 'heading.findings');
  need(anyPicked(content.focus), 'heading.focus', 'heading.focus');
  need(Object.keys(content.maps).length > 0, 'heading.brain', 'label.maps');
  for (const band of BAND_IDS) {
    need(bandIsComplete(content, band), 'heading.brain', `band.${band}.name`);
  }
  for (const id of CONNECTIVITY_IDS) {
    need(connectivityIsComplete(content, id), 'label.findings', `connectivity.${id}.title`);
  }
  for (const dimension of DIMENSION_IDS) {
    need(
      content.dashboard[dimension].score !== null,
      'heading.dashboard',
      `dimension.${dimension}.title`,
    );
  }
  need(anyPicked(content.recommendations), 'heading.recommendations', 'heading.recommendations');
  need(!isEmpty(content.summary.en), 'heading.summary', 'heading.summary');
  need(anyPicked(content.benefits), 'heading.benefits', 'heading.benefits');
  need(content.plan.sessions !== null, 'heading.programme', 'label.sessions');
  const direction = content.edition === 'initial' ? content.plan.approach : content.plan.next;
  need(direction !== null, 'heading.approach', 'heading.approach');
  return missing;
}
