/**
 * A brain-map report turned into the parts of its pages: what is drawn, in
 * what order, and how each part behaves at a page break. A first report and
 * a follow-up both.
 *
 * **The one place a report's content meets the pieces.** A piece knows
 * nothing of a finding or a score (`pieces/`), and the pages know nothing of
 * a report (`paginate.ts`). This joins the two: it reads the content and the
 * facts a report does not hold itself, asks the wording for every word
 * (`phrase`, and the sentences built from it in `sentences.ts`), hands the
 * words to a piece, and says of each part whether it starts a page, stays
 * with what follows, or is pinned to the foot. So the look of the report can
 * be reviewed apart from what it says (`docs/SPEC/reports-qeeg.md`
 * section 12, "How the pieces are made").
 *
 * **The order is the practice's.** The client and the recording, the
 * overview, the key findings and the areas of focus; a page for each brain
 * map; the bands and then the three kinds of connectivity; the dashboard;
 * the recommendations, the summary and the benefits; the programme, its
 * length and the sessions, the approach training begins with; the closing
 * paragraphs, the final note, the agreement's standing sentences and the
 * signature.
 *
 * **A follow-up is the same report**, in the same order, with its own words
 * (every phrase is asked for in the edition the content carries): its own
 * lists of changes, the earlier score beside each score of the dashboard,
 * the summary's standing opening above her own, and the next stage of
 * training where a first report has the approach it begins with. It adds
 * what it is compared with to the recording's column, and one page of its
 * own, what has changed, after the brain maps (`changePage.ts`). It has no
 * brain-map-only choice: a follow-up comes after training.
 *
 * **A part is laid at a width, not once** (`parts.ts`).
 *
 * **One part a paragraph.** A long summary runs over a page; set as one part
 * per paragraph, each can be cut between its lines (`Block.split`) and the
 * next begins where it should. The old tool set the whole summary as one
 * block, which ran over the footer.
 *
 * **What is not the report's to say is not in it.** The client's name and
 * the practice's lines are gathered, the reference and the day of issue are
 * the signing's, and the signer is snapshotted from a credential at signing;
 * a preview has none of the last three and prints the room for them. The
 * content holds the rest of what is gathered (the Arabic name, the age, the
 * sex), which the server writes into it on every save and at signing.
 *
 * Pure: the faces arrive measured in the `Drawing`, and no byte of a picture
 * is read here.
 */

import type { DocumentImage } from '@domain/shared/document';
import { STANDING_SENTENCES, WORDS } from '../../document/strings';
import type { SignerSnapshot } from '../../types';
import {
  BAND_IDS,
  BENEFIT_IDS,
  CONNECTIVITY_IDS,
  DIMENSION_IDS,
  FINDING_IDS,
  FOCUS_IDS,
  RECOMMENDATION_IDS,
  tierOf,
} from '../catalogue/ids';
import type { DimensionId } from '../catalogue/ids';
import { classifyScoreChange } from '../scoreChange';
import type { ScoreMovement } from '../scoreChange';
import {
  approachLine,
  bandHeading,
  bandSentence,
  connectivitySentence,
  earlierTerm,
  paragraph,
  programmeAgreed,
  sessionLabel,
} from '../sentences';
import { isBlank, richFor, spansOf, textFor, toParagraphs } from '../text';
import type { CustomItem, Locale, Ordered, Picked, QeegContent } from '../types';
import { fill, phrase } from '../wording';
import type { Block } from './block';
import { changeParts } from './changePage';
import { GAP } from './geometry';
import { dayOf, mapImageKey, NOTHING_YET, part, spansOfRich } from './parts';
import type { Part } from './parts';
import type { Span } from './paragraph';
import { bandBlock } from './pieces/bandBlock';
import { bulletList } from './pieces/bulletList';
import { connectivityBlock } from './pieces/connectivityBlock';
import type { CardInput } from './pieces/dashboardCard';
import { dashboardGrid } from './pieces/dashboardGrid';
import { heading } from './pieces/heading';
import { infoPanel } from './pieces/infoPanel';
import type { InfoLine } from './pieces/infoPanel';
import { mapBlock } from './pieces/mapBlock';
import { recommendationRow } from './pieces/recommendationRow';
import { sessionsPill } from './pieces/sessionsPill';
import { signatureBlock } from './pieces/signatureBlock';
import { fixed, typed } from './pieces/words';
import type { Points } from './pieces/followup/figureLine';
import type { Words } from './pieces/words';
import { typeset } from './typeset';
import type { Drawing } from './typeset';
import type { Role } from './styles';

export { mapImageKey, SECTIONS } from './parts';
export type { Part, Section } from './parts';

/** The practice, as its lines at the foot of every page print it. */
export type PracticeLines = {
  readonly name: string;
  readonly nameAr: string | null;
  readonly address: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly website: string | null;
};

/** What a report does not hold itself. */
export type ReportFacts = {
  /** The client's name as the record holds it. */
  readonly clientName: string;
  /** The practice's reference, from signing; none on a preview. */
  readonly reference: string | null;
  /** The day of issue as `YYYY-MM-DD`, from signing; none on a preview. */
  readonly issuedOn: string | null;
  /** Who signed, snapshotted from their credential; none on a preview. */
  readonly signer: SignerSnapshot | null;
  readonly practice: PracticeLines;
  /** The practice's logo, or none: the header then keeps its room and draws nothing. */
  readonly logo: DocumentImage | null;
  /** Each brain map's picture, by the figure id the content records. */
  readonly pictures: Readonly<Record<string, DocumentImage>>;
  // A follow-up's pairs name the earlier report's maps as well as its own:
  // each is looked up here by its figure id, as the report's own maps are.
};

export type ReportInput = {
  /** Content that has passed the shape (`validateQeegContent`), of either edition. */
  readonly content: QeegContent;
  readonly locale: Locale;
  readonly facts: ReportFacts;
};

/**
 * What a first report leaves out when no programme was agreed: a brain map
 * with no training after it (the practice's request of 30 September 2026,
 * `programmeAgreed`). The page's heading, the closing paragraphs, the final
 * note and the signature are drawn as always.
 *
 * The practice may yet ask for the programme's own introduction
 * (`programme.text`, the wording's `text.programme`) and the two closing
 * paragraphs (`closing.monitoring` and `closing.gradual`, the wording's
 * `text.monitoring` and `text.gradual`) to go too. Each is then one more id
 * in this list, and nothing else changes.
 *
 * **It takes two section marks away too.** Spare room on a page is shared
 * among the parts that open a section (`breathe`). With the programme's
 * parts gone, only the closing paragraphs and the final note would be left
 * to share it, and each would take the whole cap: two wide gaps on a short
 * page. So on a brain-map-only report `closing.monitoring` and `final.note`
 * open no section and keep the gap of a paragraph, and the spare room goes
 * above the pinned signature.
 */
export const LEFT_OUT_WITHOUT_PROGRAMME: readonly string[] = Object.freeze([
  'programme.length',
  'programme.sessions',
  'approach.heading',
  'approach.text',
  'approach.line',
]);

/** The key the engine looks the logo up by. */
export const LOGO_IMAGE = 'logo';

/** The wording's `**bold**` read into spans. */
function spansFrom(marked: string): Span[] {
  return spansOf(marked).map((span) => (span.bold ? { text: span.text, bold: true } : span));
}

/** Her own items of a list that she chose, in the order she placed them. */
function customChosen(custom: Ordered<CustomItem>): (CustomItem & { position: number })[] {
  return Object.values(custom)
    .filter((item) => item.chosen)
    .sort((one, other) => one.position - other.position);
}

/** What was ticked, in the order of the list, then what she added and chose. */
function listed<Id extends string>(
  picked: Picked<Id>,
  ids: readonly Id[],
  keyOf: (id: Id) => string,
  say: (key: string) => string,
  locale: Locale,
): Words[] {
  return [
    ...ids.filter((id) => picked.chosen.includes(id)).map((id) => fixed(say(keyOf(id)))),
    ...customChosen(picked.custom).map((item) => typed(textFor(locale, item.label))),
  ];
}

/**
 * A list that may be cut between its items when a page asks: the most items
 * that stand in the room, set as a list of their own, and the rest as
 * another, which may be cut again. The piece never cuts a list (its
 * columns would lose their balance), so a list longer than a page is set as
 * two lists, each balanced. A list of one item, or none, is never cut.
 */
function cutBetweenItems(
  listOf: (items: readonly Words[]) => Block,
  items: readonly Words[],
): Block {
  const whole = listOf(items);
  return {
    ...whole,
    split: (room) => {
      let fits = 0;
      for (let count = items.length - 1; count >= 1; count -= 1) {
        const first = listOf(items.slice(0, count));
        if (first.height + first.overhang <= room) {
          fits = count;
          break;
        }
      }
      if (fits === 0) return null;
      return [listOf(items.slice(0, fits)), cutBetweenItems(listOf, items.slice(fits))];
    },
  };
}

/** The practice's lines at the foot of every page, and the words for which page of how many. */
export function footerOf(input: ReportInput): {
  readonly lines: readonly Words[];
  readonly page: (page: number, total: number) => string;
} {
  const { content, locale, facts } = input;
  const say = (key: string) => phrase(key, content.edition, locale);
  const between = say('list.between');
  const { practice } = facts;
  const name =
    locale === 'ar' && practice.nameAr !== null && !isBlank(practice.nameAr)
      ? practice.nameAr
      : practice.name;
  const where = [name, practice.address].filter(
    (each): each is string => each !== null && !isBlank(each),
  );
  const contacts: readonly (readonly [string, string | null])[] = [
    ['footer.phone', practice.phone],
    ['footer.email', practice.email],
    ['footer.website', practice.website],
  ];
  const reach = contacts.flatMap(([key, value]) =>
    value === null || isBlank(value) ? [] : [`${say(key)}: ${value}`],
  );
  return {
    lines: [fixed(where.join(between)), fixed(reach.join(between))].filter(
      (line) => line.text !== '',
    ),
    page: (page, total) => fill(say('page.of'), { page, total }),
  };
}

/** The file's title, in English whatever the language of its pages: a browser tab reads it. */
export function titleOf(input: {
  readonly content: Pick<QeegContent, 'stage' | 'edition'>;
  readonly facts: { readonly reference: string | null };
}): string {
  const stage = phrase(`value.stage.${input.content.stage}`, input.content.edition, 'en');
  return input.facts.reference === null ? stage : `${stage} ${input.facts.reference}`;
}

/** The shape a score's movement is marked by: none for one that held. */
const POINTS: Readonly<Record<ScoreMovement, Points | null>> = Object.freeze({
  higher: 'up',
  lower: 'down',
  steady: null,
});

/**
 * A follow-up's earlier score, "was 4", marked by the way the score moved
 * when both are set. Whether it moved is the practice's rule
 * (`classifyScoreChange`), asked and never restated here.
 */
function earlierOf(content: QeegContent, id: DimensionId, locale: Locale): CardInput['earlier'] {
  if (content.edition !== 'follow-up') return null;
  const { score, earlierScore } = content.dashboard[id];
  if (earlierScore === null) return null;
  const words = fill(phrase('label.earlier_score', content.edition, locale), {
    score: earlierScore,
  });
  return {
    words: fixed(words),
    points: score === null ? null : POINTS[classifyScoreChange(earlierScore, score)],
  };
}

/** The six cards of the dashboard. A card with no score yet says nothing of what a score would mean. */
function cardsOf(content: QeegContent, locale: Locale): CardInput[] {
  const say = (key: string) => phrase(key, content.edition, locale);
  return DIMENSION_IDS.map((id: DimensionId): CardInput => {
    const { score, evidence } = content.dashboard[id];
    const earlier = earlierOf(content, id, locale);
    const title = say(`dimension.${id}.title`);
    const outOf = say('label.out_of_ten');
    const given =
      evidence !== null && !isBlank(textFor(locale, evidence))
        ? { label: say('label.evidence'), words: typed(textFor(locale, evidence)) }
        : null;
    if (score === null) {
      return {
        score: null,
        tier: null,
        outOf,
        category: '',
        title,
        summary: '',
        evidence: given,
        meaning: { label: '', items: [] },
        advice: [],
        earlier,
      };
    }
    const tier = tierOf(score);
    const at = `dimension.${id}.${tier}`;
    return {
      score,
      tier,
      outOf,
      category: say(`tier.${tier}`),
      title,
      summary: say(`${at}.summary`),
      evidence: given,
      meaning: {
        label: say('label.meaning'),
        items: [1, 2, 3].map((point) => say(`${at}.point.${point}`)),
      },
      advice: spansFrom(`**${say('label.advice')}** ${say(`${at}.advice`)}`),
      earlier,
    };
  });
}

/** The parts of a report's pages, in order. `bodyHeight` is the room a map may fill. */
export function buildQeegReport(input: ReportInput, drawing: Drawing, bodyHeight: number): Part[] {
  const { content, locale, facts } = input;
  // Every phrase in the edition the content carries: a sentence both share
  // reads the same either way, and one that differs is the edition's own.
  const say = (key: string) => phrase(key, content.edition, locale);
  const colon = (key: string) => `${say(key)}:`;
  const parts: Part[] = [];
  // Asked first: a brain map with no programme opens fewer sections.
  const agreed = programmeAgreed(content);

  const words =
    (role: Role, content_: string | readonly Span[], setting = {}) =>
    (width: number) =>
      typeset(role, content_, width, drawing, setting);
  const title = (key: string, level: 'heading' | 'subheading') => (width: number) =>
    heading({ words: fixed(say(key)), level }, width, drawing);

  // The client and the recording.
  const name =
    locale === 'ar' && content.subject.nameAr !== null && !isBlank(content.subject.nameAr)
      ? content.subject.nameAr
      : facts.clientName;
  const line = (key: string, value: string | null): InfoLine => ({
    label: colon(key),
    value: value ?? '',
  });
  const { subject, recording } = content;
  const recordingLines: InfoLine[] = [
    line('label.date', dayOf(recording.recordedOn)),
    line('label.assessment', say(`value.stage.${content.stage}`)),
    ...(content.edition === 'follow-up'
      ? [
          line(
            'label.compared_with',
            [
              earlierTerm(content, locale),
              dayOf(content.comparedWith.recordedOn),
              ...(content.comparedWith.reference === null ? [] : [content.comparedWith.reference]),
            ].join(say('list.between')),
          ),
        ]
      : []),
    ...(facts.reference !== null
      ? [{ label: `${WORDS.reference[locale]}:`, value: facts.reference }]
      : []),
    ...(facts.issuedOn !== null
      ? [{ label: `${WORDS.dateOfIssue[locale]}:`, value: dayOf(facts.issuedOn) }]
      : []),
  ];
  parts.push(
    part(
      'client',
      'client',
      (width) =>
        infoPanel(
          {
            first: {
              title: say('heading.client'),
              lines: [
                line('label.name', name),
                line('label.age', subject.ageYears === null ? null : String(subject.ageYears)),
                line('label.sex', subject.sex === null ? null : say(`value.sex.${subject.sex}`)),
                line(
                  'label.handedness',
                  recording.handedness === null
                    ? null
                    : say(`value.handedness.${recording.handedness}`),
                ),
                line(
                  'label.eyes',
                  recording.eyes === null ? null : say(`value.eyes.${recording.eyes}`),
                ),
              ],
            },
            second: { title: say('heading.recording'), lines: recordingLines },
          },
          width,
          drawing,
        ),
      { marginBottom: GAP.afterPanel },
    ),
  );

  // The overview, the key findings and the areas of focus.
  const opening = { marginBottom: GAP.afterSubheading, keep: true, sectionStart: true };
  parts.push(
    part('overview.heading', 'overview', title('heading.overview', 'subheading'), opening),
    part('overview.text', 'overview', words('body', paragraph('text.overview', content, locale)), {
      marginBottom: GAP.afterParagraph,
    }),
  );
  const listOf =
    (items: readonly Words[], columns: 'auto' | 'two') =>
    (width: number): Block =>
      cutBetweenItems(
        (some) =>
          bulletList({ items: some, columns, empty: say('text.none_selected') }, width, drawing),
        items,
      );
  const section = (
    at: 'findings' | 'focus',
    headingKey: string,
    leadKey: string,
    items: readonly Words[],
  ) => [
    part(`${at}.heading`, at, title(headingKey, 'subheading'), opening),
    part(`${at}.lead`, at, words('lede', paragraph(leadKey, content, locale)), {
      marginBottom: GAP.afterParagraph,
      keep: true,
    }),
    part(`${at}.list`, at, listOf(items, 'auto'), { marginBottom: GAP.afterList }),
  ];
  parts.push(
    ...section(
      'findings',
      'heading.findings',
      'text.findings',
      listed(content.findings, FINDING_IDS, (id) => `finding.${id}`, say, locale),
    ),
    ...section(
      'focus',
      'heading.focus',
      'text.focus',
      listed(content.focus, FOCUS_IDS, (id) => `focus.${id}`, say, locale),
    ),
  );

  // A page for each brain map.
  const maps = Object.values(content.maps).sort((one, other) => one.position - other.position);
  for (const map of maps) {
    const picture = facts.pictures[map.figureId];
    if (!picture) {
      throw new RangeError(
        `buildQeegReport was given no picture for the map at place ${map.position + 1}.`,
      );
    }
    if (picture.width !== map.widthPx || picture.height !== map.heightPx) {
      throw new RangeError(
        `buildQeegReport was given a picture ${picture.width} by ${picture.height} for a map of ${map.widthPx} by ${map.heightPx}.`,
      );
    }
    const caption = map.caption === null ? '' : textFor(locale, map.caption);
    const label = !isBlank(caption)
      ? typed(caption)
      : map.condition !== null
        ? fixed(say(`map.${map.condition}`))
        : null;
    parts.push(
      part(
        `map.${map.position}`,
        'maps',
        (width) =>
          mapBlock(
            {
              label,
              image: mapImageKey(map.figureId),
              pixels: { width: map.widthPx, height: map.heightPx },
            },
            width,
            drawing,
            { room: bodyHeight },
          ),
        { newPage: true },
      ),
    );
  }

  // A follow-up's own page: what has changed since the report it is compared with.
  if (content.edition === 'follow-up') {
    parts.push(...changeParts(content, locale, facts, drawing, bodyHeight));
  }

  // Understanding your brain: the bands, then the kinds of connectivity.
  parts.push(
    part('brain.heading', 'brain', title('heading.brain', 'heading'), {
      marginBottom: GAP.afterHeading,
      newPage: true,
      keep: true,
    }),
  );
  for (const band of BAND_IDS) {
    const lines = [
      [
        { text: `${bandHeading(band, locale)} `, bold: true },
        { text: `${say('label.associated')} `, bold: true },
        { text: say(`band.${band}.associated`) },
      ],
      [{ text: `${say('label.influence')} `, bold: true }, { text: say(`band.${band}.influence`) }],
      spansFrom(bandSentence(content, band, locale)),
    ] as const;
    parts.push(
      part(`band.${band}`, 'brain', (width) => bandBlock({ band, lines }, width, drawing), {
        marginBottom: GAP.afterBand,
      }),
    );
  }
  CONNECTIVITY_IDS.forEach((id, index) => {
    parts.push(
      part(
        `connectivity.${id}`,
        'connectivity',
        (width) =>
          connectivityBlock(
            {
              title: say(`connectivity.${id}.title`),
              description: say(`connectivity.${id}.description`),
              finding: [
                { text: `${say('label.findings')} `, bold: true },
                ...spansFrom(connectivitySentence(content, id, locale)),
              ],
            },
            width,
            drawing,
          ),
        { marginBottom: GAP.afterConnectivity, gapBefore: index === 0 },
      ),
    );
  });

  // The dashboard, scaled to its page.
  const cards = cardsOf(content, locale);
  parts.push(
    part('dashboard.heading', 'dashboard', title('heading.dashboard', 'heading'), {
      marginBottom: GAP.afterHeading,
      newPage: true,
      keep: true,
    }),
    part('dashboard.note', 'dashboard', words('note', say('text.dashboard')), {
      marginTop: -GAP.noteRaisedBy,
      marginBottom: GAP.afterNote,
      keep: true,
    }),
    part('dashboard.grid', 'dashboard', (width) => dashboardGrid({ cards }, width, drawing), {
      fit: true,
    }),
  );

  // The recommendations, the summary and the benefits.
  parts.push(
    part(
      'recommendations.heading',
      'recommendations',
      title('heading.recommendations', 'heading'),
      {
        marginBottom: GAP.afterHeading,
        newPage: true,
        keep: true,
      },
    ),
    part(
      'recommendations.lead',
      'recommendations',
      words('lede', paragraph('text.recommendations', content, locale)),
      { marginBottom: GAP.afterParagraph, keep: true },
    ),
  );
  const rows = [
    ...RECOMMENDATION_IDS.filter((id) => content.recommendations.chosen.includes(id)).map((id) => ({
      name: fixed(say(`recommendation.${id}.name`)),
      text: fixed(say(`recommendation.${id}.text`)) as Words | null,
    })),
    ...customChosen(content.recommendations.custom).map((item) => ({
      name: typed(textFor(locale, item.label)),
      text: item.note === null ? null : typed(textFor(locale, item.note)),
    })),
  ];
  if (rows.length === 0) {
    parts.push(
      part('recommendations.none', 'recommendations', words('empty', say('text.none_selected')), {
        marginBottom: GAP.afterList,
      }),
    );
  }
  rows.forEach((row, index) => {
    parts.push(
      part(
        `recommendation.${index + 1}`,
        'recommendations',
        (width) => recommendationRow({ number: index + 1, ...row }, width, drawing),
        {},
      ),
    );
  });

  const late = { marginTop: GAP.beforeLateHeading, marginBottom: GAP.afterSubheading, keep: true };
  parts.push(part('summary.heading', 'summary', title('heading.summary', 'subheading'), late));
  // A follow-up's summary opens with the practice's own paragraph, above hers,
  // every time (the wording sheet of 29 September 2026, point 10).
  const lead = content.edition === 'follow-up';
  if (lead) {
    parts.push(
      part(
        'summary.lead',
        'summary',
        words('body', paragraph('text.summary_lead', content, locale)),
        { marginBottom: GAP.afterParagraph },
      ),
    );
  }
  const paragraphs = toParagraphs(richFor(locale, content.summary));
  if (paragraphs.length === 0 && !lead) {
    parts.push(
      part('summary.none', 'summary', words('empty', NOTHING_YET), {
        marginBottom: GAP.afterParagraph,
      }),
    );
  }
  paragraphs.forEach((each, index) => {
    parts.push(
      part(`summary.${index + 1}`, 'summary', words('body', spansOfRich(each), { typed: true }), {
        marginBottom: index === paragraphs.length - 1 ? GAP.afterParagraph : GAP.betweenParagraphs,
      }),
    );
  });
  parts.push(
    part('benefits.heading', 'benefits', title('heading.benefits', 'subheading'), late),
    part(
      'benefits.list',
      'benefits',
      listOf(
        listed(content.benefits, BENEFIT_IDS, (id) => `benefit.${id}`, say, locale),
        'two',
      ),
      { marginBottom: GAP.afterList },
    ),
  );

  // The programme, and the approach training begins with or its next stage.
  const sessions = content.plan.sessions;
  const pill = typeof sessions === 'number' ? sessionLabel(sessions, locale) : NOTHING_YET;
  parts.push(
    part('programme.heading', 'programme', title('heading.programme', 'heading'), {
      marginBottom: GAP.afterHeading,
      newPage: true,
      keep: true,
    }),
    part(
      'programme.text',
      'programme',
      words('body', paragraph('text.programme', content, locale)),
      {
        marginBottom: GAP.afterParagraph,
      },
    ),
    part(
      'programme.length',
      'programme',
      words('body', paragraph('text.programme_length', content, locale)),
      { marginBottom: GAP.afterParagraph, keep: true, sectionStart: true },
    ),
    part(
      'programme.sessions',
      'programme',
      (width) => sessionsPill({ label: pill }, width, drawing),
      {},
    ),
    part('approach.heading', 'approach', title('heading.approach', 'subheading'), opening),
    part('approach.text', 'approach', words('lede', paragraph('text.approach', content, locale)), {
      marginBottom: GAP.afterParagraph,
      keep: true,
    }),
    part(
      'approach.line',
      'approach',
      words('body', spansFrom(approachLine(content, locale) ?? NOTHING_YET)),
      { marginBottom: GAP.afterParagraph },
    ),
  );

  // The close: two paragraphs, the final note, the agreement's own sentences, the signature.
  parts.push(
    part(
      'closing.monitoring',
      'closing',
      words('body', paragraph('text.monitoring', content, locale)),
      {
        marginBottom: GAP.afterParagraph,
        sectionStart: agreed,
      },
    ),
    part('closing.gradual', 'closing', words('body', paragraph('text.gradual', content, locale)), {
      marginBottom: GAP.afterParagraph,
    }),
    part(
      'final.note',
      'final',
      words('body', spansFrom(paragraph('text.final_note', content, locale))),
      {
        marginBottom: GAP.afterParagraph,
        sectionStart: agreed,
      },
    ),
    part(
      'final.standing',
      'final',
      words('body', STANDING_SENTENCES.map((sentence) => sentence[locale]).join(' ')),
      { marginBottom: GAP.afterParagraph, keep: true },
    ),
  );
  const { signer } = facts;
  const signed: Words[] =
    signer === null
      ? []
      : [
          typed(signer.name),
          typed(signer.certification),
          ...(signer.certifyingBody === null ? [] : [typed(signer.certifyingBody)]),
          ...(signer.certificateNumber === null
            ? []
            : [fixed(`${WORDS.certificateNumber[locale]}: ${signer.certificateNumber}`)]),
        ];
  parts.push(
    part(
      'signature',
      'signature',
      (width) => signatureBlock({ label: WORDS.signedBy[locale], lines: signed }, width, drawing),
      { marginTop: GAP.beforeSignature, keep: true, pinBottom: true },
    ),
  );

  return agreed ? parts : parts.filter((each) => !LEFT_OUT_WITHOUT_PROGRAMME.includes(each.id));
}
