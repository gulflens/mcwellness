/**
 * What she chose last time, offered beside a follow-up and taken one by one
 * (docs/SPEC/reports-qeeg.md section 16, point 7; brief S).
 *
 * **Offered, never filled in.** `prefillFollowUp` hands `offered` over beside
 * the content, and nothing of it is in the content until she takes it. Each
 * function here takes one thing, exactly as ticking it in the form would: a
 * finding from the list is ticked in the list's own order; an item she added
 * herself last time becomes one of her own again, ticked, at the end of her
 * list, under a key the app makes; a band's earlier regions join the regions
 * she has. What she has already taken, or chosen herself, is no longer
 * offered (`stillOffered`), so the suggestions shrink as she goes.
 *
 * **Why here and not in the form.** Keys, places without a gap, and the
 * list's own order are the shape's rules (section 4, rules 2 and 9), and one
 * list's items are told apart from another's only here. The form asks.
 *
 * Every function returns a new content, or the one given when there is
 * nothing to do; nothing it is given is changed.
 */

import {
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  RECOMMENDATION_IDS,
  REGION_IDS,
  type BandId,
  type ConnectivityId,
} from './catalogue/ids';
import type { Offered } from './prefill';
import { freeKey, OfferedShape } from './shape';
import type { CustomItem, Picked, QeegFollowUp, Regions } from './types';

/** The four lists a follow-up shares with the report before it. */
export type OfferedList = 'findings' | 'focus' | 'recommendations' | 'benefits';

const LIST_IDS: { readonly [L in OfferedList]: readonly string[] } = {
  findings: FINDING_IDS,
  focus: FOCUS_IDS,
  recommendations: RECOMMENDATION_IDS,
  benefits: BENEFIT_IDS,
};

type Placed = CustomItem & { readonly position: number };

/** Whether `value` is what the prefill answers as `offered`. */
export function isOffered(value: unknown): value is Offered {
  return OfferedShape.safeParse(value).success;
}

function inListOrder(ids: readonly string[], chosen: readonly string[]): string[] {
  return ids.filter((id) => chosen.includes(id));
}

function sameLabel(a: CustomItem, b: CustomItem): boolean {
  return a.label.en.trim() === b.label.en.trim();
}

function withList(content: QeegFollowUp, list: OfferedList, picked: Picked<string>): QeegFollowUp {
  return { ...content, [list]: picked } as QeegFollowUp;
}

/** `id` ticked in `list`. */
export function takeChosen(content: QeegFollowUp, list: OfferedList, id: string): QeegFollowUp {
  const was: Picked<string> = content[list];
  if (was.chosen.includes(id) || !LIST_IDS[list].includes(id)) return content;
  return withList(content, list, {
    chosen: inListOrder(LIST_IDS[list], [...was.chosen, id]),
    custom: was.custom,
  });
}

/** The item she added last time under `key`, added again as one of her own. */
export function takeCustom(
  content: QeegFollowUp,
  list: OfferedList,
  key: string,
  offered: Offered,
): QeegFollowUp {
  const source: Picked<string> = offered[list];
  const item = Object.hasOwn(source.custom, key) ? source.custom[key] : undefined;
  const was: Picked<string> = content[list];
  if (item === undefined || Object.values(was.custom).some((own) => sameLabel(own, item))) {
    return content;
  }
  const added: Placed = {
    label: { ...item.label },
    note: item.note === null ? null : { ...item.note },
    chosen: true,
    position: Object.keys(was.custom).length,
  };
  return withList(content, list, {
    chosen: was.chosen,
    custom: { ...was.custom, [freeKey(was.custom, 'c')]: added },
  });
}

function joined(have: Regions, add: Regions): Regions {
  return REGION_IDS.filter((region) => have.includes(region) || add.includes(region));
}

/** A band's, or a kind of connectivity's, earlier regions joined to hers. */
export function takeRegions(
  content: QeegFollowUp,
  kind: 'bands' | 'connectivity',
  id: BandId | ConnectivityId,
  offered: Offered,
): QeegFollowUp {
  if (kind === 'bands') {
    const band = id as BandId;
    if (!BAND_IDS.includes(band)) return content;
    const was = content.bands[band];
    return {
      ...content,
      bands: {
        ...content.bands,
        [band]: { ...was, regions: joined(was.regions, offered.regions.bands[band]) },
      },
    };
  }
  const link = id as ConnectivityId;
  if (!CONNECTIVITY_IDS.includes(link)) return content;
  const was = content.connectivity[link];
  return {
    ...content,
    connectivity: {
      ...content.connectivity,
      [link]: { ...was, regions: joined(was.regions, offered.regions.connectivity[link]) },
    },
  };
}

function stillPicked<Id extends string>(offer: Picked<Id>, have: Picked<string>): Picked<Id> {
  const custom = Object.entries(offer.custom)
    .filter(([, item]) => !Object.values(have.custom).some((own) => sameLabel(own, item)))
    .map(([key, item], position) => [key, { ...item, position }] as const);
  return {
    chosen: offer.chosen.filter((id) => !have.chosen.includes(id)),
    custom: Object.fromEntries(custom),
  };
}

function stillRegions(offer: Regions, have: Regions): Regions {
  return offer.filter((region) => !have.includes(region));
}

/** What is still offered, once what she already has is taken out. */
export function stillOffered(content: QeegFollowUp, offered: Offered): Offered {
  const bands = Object.fromEntries(
    BAND_IDS.map((b) => [b, stillRegions(offered.regions.bands[b], content.bands[b].regions)]),
  ) as Record<BandId, Regions>;
  const connectivity = Object.fromEntries(
    CONNECTIVITY_IDS.map((c) => [
      c,
      stillRegions(offered.regions.connectivity[c], content.connectivity[c].regions),
    ]),
  ) as Record<ConnectivityId, Regions>;
  return {
    findings: stillPicked(offered.findings, content.findings),
    focus: stillPicked(offered.focus, content.focus),
    recommendations: stillPicked(offered.recommendations, content.recommendations),
    benefits: stillPicked(offered.benefits, content.benefits),
    regions: { bands, connectivity },
  };
}

/** Whether nothing at all is offered. */
export function nothingOffered(offered: Offered): boolean {
  const lists = [offered.findings, offered.focus, offered.recommendations, offered.benefits];
  return (
    lists.every((list) => list.chosen.length === 0 && Object.keys(list.custom).length === 0) &&
    BAND_IDS.every((b) => offered.regions.bands[b].length === 0) &&
    CONNECTIVITY_IDS.every((c) => offered.regions.connectivity[c].length === 0)
  );
}
