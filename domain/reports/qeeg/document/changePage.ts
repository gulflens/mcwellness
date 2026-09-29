/**
 * A follow-up's page of what has changed, as the parts of its pages
 * (`docs/SPEC/reports-qeeg.md` section 10): the headlines, the earlier maps
 * beside the later ones, the change by frequency band, her summary, and the
 * note that says where the figures came from.
 *
 * **Every figure is optional.** A headline she left empty is not printed, a
 * row of the table with no figure is not printed, a pair with neither map is
 * not printed, and a heading with nothing under it goes with it. A page of
 * pictures and words alone is a whole page; a page with nothing on it yet
 * (a draft previewed before it is filled) prints its heading and a dash.
 *
 * **No figure is read from a picture.** A figure on this page is hers or
 * was calculated by the server from two recorded assessments; this only
 * says it in words. A picture is a name the engine looks up and its size.
 *
 * **Direction is a shape.** A figure that rose or fell is marked by a
 * triangle in the ink (`figureLine`), and what that means is said in her
 * summary, never by a colour.
 *
 * **The note follows from the figures** (`changeNoteKey`): the practitioner
 * never chooses it, and a page with no figure prints none.
 *
 * **One page when it can.** The maps of the pairs are the one part that can
 * be drawn smaller, so `planFollowUp` shares the room the page has between
 * them. Where the page cannot be one, it breaks between whole parts: a pair,
 * the row of headlines and a row of the table are never cut, and the table's
 * head stays with at least two of its rows.
 */

import { MEASURE_IDS, MEASURE_RANGES } from '../catalogue/ids';
import type { MeasureId } from '../catalogue/ids';
import { changeNoteKey } from '../changeNote';
import { richFor, textFor, toParagraphs } from '../text';
import type { ChangeFigure, ChangeRow, Condition, FigureRef, Locale, QeegFollowUp } from '../types';
import { fill, phrase } from '../wording';
import type { ReportFacts } from './build';
import { CHANGE, GAP, BODY_WIDTH } from './geometry';
import { limitsFor } from './paginate';
import { dayOf, mapImageKey, NOTHING_YET, part, spansOfRich } from './parts';
import type { Part } from './parts';
import { changeHead, changeRow } from './pieces/followup/changeRow';
import type { FigureLineInput } from './pieces/followup/figureLine';
import { headlines } from './pieces/followup/headlines';
import type { HeadlineTile } from './pieces/followup/headlines';
import { mapPair } from './pieces/followup/mapPair';
import type { PairSide } from './pieces/followup/mapPair';
import { heading } from './pieces/heading';
import { fixed, typed } from './pieces/words';
import { planFollowUp } from './planFollowUp';
import type { PlanPart } from './planFollowUp';
import { typeset } from './typeset';
import type { Drawing } from './typeset';

/** The pairs in the order the page prints them: eyes closed, then eyes open (section 10). */
export const PAIR_ORDER: readonly Condition[] = Object.freeze(['eyes_closed', 'eyes_open']);

/** A figure in the words of the report, and which way it moved. */
export function figureWords(figure: ChangeFigure, locale: Locale): FigureLineInput {
  const say = (key: string) => phrase(key, 'follow-up', locale);
  if (figure.kind === 'no_appreciable_change') {
    return { words: fixed(say('figure.none')), points: null };
  }
  const amount =
    figure.high === null
      ? fill(say('figure.about'), { value: figure.low })
      : fill(say('figure.about_range'), { low: figure.low, high: figure.high });
  const rose = figure.direction === 'increase';
  return {
    words: fixed(`${amount} ${say(rose ? 'figure.higher' : 'figure.lower')}`),
    points: rose ? 'up' : 'down',
  };
}

/** The rows she chose that hold a figure, in the order she placed them. */
export function rowsOf(content: QeegFollowUp): { id: MeasureId; row: ChangeRow }[] {
  return MEASURE_IDS.flatMap((id) => {
    const row = content.change.table[id];
    return row && (row.eyesOpen !== null || row.eyesClosed !== null) ? [{ id, row }] : [];
  }).sort((one, other) => one.row.position - other.row.position);
}

/** A map a pair names, checked against the picture handed over for it. */
function pictured(
  facts: ReportFacts,
  figure: FigureRef,
  where: string,
): NonNullable<PairSide['map']> {
  const picture = facts.pictures[figure.figureId];
  if (!picture) {
    throw new RangeError(`buildQeegReport was given no picture for the ${where}.`);
  }
  if (picture.width !== figure.widthPx || picture.height !== figure.heightPx) {
    throw new RangeError(
      `buildQeegReport was given a picture ${picture.width} by ${picture.height} for the ${where}, of ${figure.widthPx} by ${figure.heightPx}.`,
    );
  }
  return {
    image: mapImageKey(figure.figureId),
    pixels: { width: figure.widthPx, height: figure.heightPx },
  };
}

/** The parts of a follow-up's page of what has changed, in order. */
export function changeParts(
  content: QeegFollowUp,
  locale: Locale,
  facts: ReportFacts,
  drawing: Drawing,
  bodyHeight: number,
): Part[] {
  const say = (key: string) => phrase(key, 'follow-up', locale);
  const { change } = content;
  const title = (key: string, level: 'heading' | 'subheading') => (width: number) =>
    heading({ words: fixed(say(key)), level }, width, drawing);
  const opening = { marginBottom: GAP.afterSubheading, keep: true, sectionStart: true };
  const before: Part[] = [];
  const after: Part[] = [];

  // The headlines: her figures, then the sessions completed and where the number came from.
  const tiles: HeadlineTile[] = [
    ...Object.values(change.tiles)
      .sort((one, other) => one.position - other.position)
      .map((tile) => ({
        figure: figureWords(tile.figure, locale),
        caption: typed(textFor(locale, tile.caption)),
        source: null,
      })),
    ...(change.sessionsCompleted === null
      ? []
      : [
          {
            figure: { words: fixed(String(change.sessionsCompleted.count)), points: null },
            caption: fixed(say('tile.sessions_completed')),
            source: say(`tile.sessions.${change.sessionsCompleted.source}`),
          },
        ]),
  ];
  if (tiles.length > 0) {
    before.push(
      part('change.headlines', 'change', (width) => headlines({ tiles }, width, drawing), {
        marginBottom: CHANGE.afterHeadlines,
      }),
    );
  }

  // Before and after: each pair with a map on either side, eyes closed first.
  const earlierLabel = say(`pair.earlier.${content.comparedWith.relation}`);
  const sidesOf = (condition: Condition): { earlier: PairSide; later: PairSide } | null => {
    const pair = change.pairs[condition];
    if (pair.earlier === null && pair.later === null) return null;
    const eyes = say(`pair.${condition}`);
    const side = (
      figure: FigureRef | null,
      recording: string,
      date: string | null,
      which: string,
    ) => ({
      label: fill(say('pair.label'), { recording, eyes }),
      date: date === null || date === '' ? null : date,
      map:
        figure === null
          ? null
          : // Named by its condition, not its words: an error reaches a log, in English.
            pictured(facts, figure, `${which} map of the ${condition.replace('_', ' ')} pair`),
      missing: say('pair.not_recorded'),
    });
    return {
      earlier: side(pair.earlier, earlierLabel, dayOf(content.comparedWith.recordedOn), 'earlier'),
      later: side(pair.later, say('pair.later'), dayOf(content.recording.recordedOn), 'later'),
    };
  };
  const pairs = PAIR_ORDER.flatMap((condition) => {
    const sides = sidesOf(condition);
    return sides ? [{ condition, sides }] : [];
  });
  const pairsHeading =
    pairs.length > 0
      ? [
          part(
            'change.pairs.heading',
            'change',
            title('heading.before_after', 'subheading'),
            opening,
          ),
        ]
      : [];
  const pairPart = (
    condition: Condition,
    sides: { earlier: PairSide; later: PairSide },
    mapHeight: number,
  ) =>
    part(
      `change.pair.${condition}`,
      'change',
      (width) => mapPair(sides, width, drawing, { mapHeight }),
      { marginBottom: CHANGE.afterPair },
    );

  // The change by frequency band: the head, kept with at least two rows.
  const rows = rowsOf(content);
  if (rows.length > 0) {
    after.push(
      part('change.table.heading', 'change', title('heading.change_table', 'subheading'), opening),
      part(
        'change.table.head',
        'change',
        (width) =>
          changeHead(
            {
              measure: say('table.measure'),
              eyesOpen: say('table.eyes_open'),
              eyesClosed: say('table.eyes_closed'),
            },
            width,
            drawing,
          ),
        { keep: true },
      ),
      ...rows.map(({ id, row }, index) => {
        const { from, to } = MEASURE_RANGES[id];
        const measure = fill(say('measure.with_range'), { name: say(`measure.${id}`), from, to });
        return part(
          `change.row.${id}`,
          'change',
          (width) =>
            changeRow(
              {
                measure,
                eyesOpen: row.eyesOpen === null ? null : figureWords(row.eyesOpen, locale),
                eyesClosed: row.eyesClosed === null ? null : figureWords(row.eyesClosed, locale),
              },
              width,
              drawing,
            ),
          {
            keep: index === 0 && rows.length >= 2,
            marginBottom: index === rows.length - 1 ? GAP.afterParagraph : 0,
          },
        );
      }),
    );
  }

  // Her summary of what has changed.
  const paragraphs = toParagraphs(richFor(locale, change.summary));
  if (paragraphs.length > 0) {
    after.push(
      part('change.summary.heading', 'change', title('heading.summary', 'subheading'), opening),
      ...paragraphs.map((each, index) =>
        part(
          `change.summary.${index + 1}`,
          'change',
          (width) => typeset('body', spansOfRich(each), width, drawing, { typed: true }),
          {
            marginBottom:
              index === paragraphs.length - 1 ? GAP.afterParagraph : GAP.betweenParagraphs,
          },
        ),
      ),
    );
  }

  // Where the figures came from, and where the earlier report was written.
  const note = changeNoteKey(change);
  const notes = [
    ...(note === null ? [] : [{ id: 'change.note', words: say(note) }]),
    ...(content.comparedWith.origin === 'imported'
      ? [{ id: 'change.earlier', words: say('note.earlier_imported') }]
      : []),
  ];
  after.push(
    ...notes.map(({ id, words }) =>
      part(id, 'change', (width) => typeset('note', words, width, drawing), {
        marginBottom: GAP.afterParagraph,
      }),
    ),
  );

  const headingPart = part('change.heading', 'change', title('heading.change', 'heading'), {
    marginBottom: GAP.afterHeading,
    newPage: true,
    keep: true,
  });
  if (before.length + pairs.length + after.length === 0) {
    return [
      headingPart,
      part('change.none', 'change', (width) => typeset('empty', NOTHING_YET, width, drawing), {
        marginBottom: GAP.afterParagraph,
      }),
    ];
  }

  // The maps take what room the rest leaves them, from the least to the preferred.
  const probes = pairs.map(({ condition, sides }) => pairPart(condition, sides, CHANGE.mapLeast));
  const planned: PlanPart[] = [
    headingPart,
    ...before,
    ...pairsHeading,
    ...probes.map((probe) => ({ ...probe, height: probe.height - CHANGE.mapLeast, mapRows: 1 })),
    ...after,
  ].map((each) => ({ mapRows: 0, ...each }));
  const { mapHeight } = planFollowUp(planned, limitsFor(BODY_WIDTH, bodyHeight));
  return [
    headingPart,
    ...before,
    ...pairsHeading,
    ...pairs.map(({ condition, sides }) => pairPart(condition, sides, mapHeight)),
    ...after,
  ];
}
