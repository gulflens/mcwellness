/**
 * The sentences a brain-map report builds from what the practitioner chose.
 *
 * **No word is written here.** Every word comes from the wording, through
 * `phrase` and `fill`, so a sentence a person approved is the sentence a
 * household reads, in either language, and mending one is a change to the
 * wording file and nowhere else. This file only decides which pieces go
 * together, in what order.
 *
 * **A sentence is a base, a clause and an end.** The base says what was seen
 * or what changed; the clause, when regions were chosen, says where; the end
 * closes it. Which clause follows which base is the only judgement here, and
 * it is the one the tool this was rebuilt from made: "across" for a band that
 * is within normal limits, "involving" for anything else.
 *
 * **Regions print in list order.** Whatever order a practitioner ticked them
 * in, the page reads front to back, so two reports that chose the same
 * regions say the same thing.
 *
 * **An unfinished draft previews without throwing.** Nothing chosen yet reads
 * as a dash. Only a missing sentence in the wording throws, because that is a
 * fault to catch at the desk and never a blank on a household's page.
 */

import { BAND_RANGES, REGION_IDS, type BandId, type ConnectivityId } from './catalogue/ids';
import type { Edition, Locale, QeegContent, QeegFollowUp, Regions } from './types';
import { fill, phrase } from './wording';

/** What a sentence reads as before anything is chosen. A mark, not a word. */
const NOTHING_YET = '—';

/**
 * A sentence both editions share. The edition only chooses between entries
 * that differ, so either one reads a shared entry the same.
 */
const shared = (key: string, locale: Locale) => phrase(key, 'initial', locale);

export function regionPhrase(regions: Regions, locale: Locale): string {
  const names = REGION_IDS.filter((id) => regions.includes(id)).map((id) =>
    shared(`region.${id}.phrase`, locale),
  );
  const last = names.pop();
  if (last === undefined) return NOTHING_YET;
  if (names.length === 0) return last;
  // In Arabic the last joiner is a letter that joins the word after it; the
  // wording holds it with no space after, and it is attached as it stands.
  return names.join(shared('list.between', locale)) + shared('list.before_last', locale) + last;
}

export function bandHeading(band: BandId, locale: Locale): string {
  const { from, to } = BAND_RANGES[band];
  return fill(shared('band.with_range', locale), {
    name: shared(`band.${band}.name`, locale),
    from,
    to,
  });
}

/** A base, then a clause naming the regions when any were chosen, then the end. */
function sentence(
  edition: Edition,
  locale: Locale,
  base: string,
  clauseKey: string,
  regions: Regions,
): string {
  const clause =
    regions.length > 0
      ? fill(phrase(clauseKey, edition, locale), { regions: regionPhrase(regions, locale) })
      : '';
  return base + clause + phrase('sentence.end', edition, locale);
}

export function bandSentence(content: QeegContent, band: BandId, locale: Locale): string {
  const { edition } = content;
  if (content.edition === 'initial') {
    const { level, regions } = content.bands[band];
    if (level === null) return NOTHING_YET;
    if (level === 'within_normal_limits') {
      const base = phrase('sentence.band.normal', edition, locale);
      return sentence(edition, locale, base, 'clause.band.across', regions);
    }
    const base = fill(phrase('sentence.band.level', edition, locale), {
      level: phrase(`level.band.${level}.word`, edition, locale),
    });
    return sentence(edition, locale, base, 'clause.band.involving', regions);
  }
  const { change, regions } = content.bands[band];
  if (change === null) return NOTHING_YET;
  const base = phrase(`change.band.${change}.sentence`, edition, locale);
  const clause =
    change === 'now_within_normal_limits' ? 'clause.band.across' : 'clause.band.involving';
  return sentence(edition, locale, base, clause, regions);
}

export function measureSentence(
  content: QeegContent,
  measure: ConnectivityId,
  locale: Locale,
): string {
  const { edition } = content;
  if (content.edition === 'initial') {
    const { level, regions } = content.connectivity[measure];
    if (level === null) return NOTHING_YET;
    const base = fill(phrase(`sentence.${measure}`, edition, locale), {
      level: phrase(`level.${measure}.${level}.word`, edition, locale),
    });
    const clause =
      measure === 'asymmetry' ? 'clause.asymmetry.involving' : 'clause.connectivity.involving';
    return sentence(edition, locale, base, clause, regions);
  }
  const { change, regions } = content.connectivity[measure];
  if (change === null) return NOTHING_YET;
  const base = phrase(`change.${measure}.${change}.sentence`, edition, locale);
  return sentence(edition, locale, base, 'clause.connectivity.involving', regions);
}

/**
 * English has one and many. Arabic agrees with the number: one, two, three
 * to ten, and eleven upwards each take their own form.
 */
function sessionForm(count: number, locale: Locale): string {
  if (count === 1) return 'sessions.one';
  if (locale === 'en') return 'sessions.many';
  if (count === 2) return 'sessions.two';
  if (count >= 3 && count <= 10) return 'sessions.few';
  return 'sessions.many';
}

export function sessionLabel(count: number, locale: Locale): string {
  return fill(shared(sessionForm(count, locale), locale), { count });
}

/** The approach of a first report, or the next stage of a follow-up; `null` until chosen. */
export function approachLine(content: QeegContent, locale: Locale): string | null {
  const { edition } = content;
  const key =
    content.edition === 'initial'
      ? content.plan.approach && `approach.${content.plan.approach}`
      : content.plan.next && `next.${content.plan.next}`;
  if (!key) return null;
  return fill(phrase('text.approach_line', edition, locale), {
    label: phrase(`${key}.label`, edition, locale),
    text: phrase(`${key}.text`, edition, locale),
  });
}

/** What the earlier report is called: the client's first, or a later one. */
export function earlierTerm(content: QeegFollowUp, locale: Locale): string {
  return phrase(`term.earlier.${content.comparedWith.relation}`, content.edition, locale);
}

/** A fixed paragraph for this edition, with the earlier report filled in on a follow-up. */
export function paragraph(key: string, content: QeegContent, locale: Locale): string {
  const template = phrase(key, content.edition, locale);
  if (content.edition === 'initial') return fill(template, {});
  return fill(template, { earlier: earlierTerm(content, locale) });
}
