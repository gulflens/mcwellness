import { DIMENSION_IDS } from '../../../../domain/reports/qeeg/catalogue/ids';
import type {
  Bilingual,
  BilingualRich,
  CustomItem,
  Locale,
  Picked,
  QeegContent,
  RichText,
} from '../../../../domain/reports/qeeg/types';
import { LIMITS } from '../../../../domain/reports/qeeg/types';
import { phrase } from '../../../../domain/reports/qeeg/wording';
import { retype } from './richEdit';

/**
 * What she typed that a second-language draft may give its own language's
 * version of, as that draft's form lists it (docs/SPEC/reports-qeeg.md section
 * 8; brief Q).
 *
 * **Only what prints.** Every piece of her own typing the report prints, in
 * the order the report prints it: an item of her own she ticked (its label,
 * and what a recommendation of hers advises), a map's label, the evidence
 * beside a score, the summary, and on a follow-up each headline and the page
 * of what has changed. An item she set aside is not printed, so its version
 * is not asked for.
 *
 * **Each writes one half.** `set` writes the text given into the half of the
 * language asked for, of that one typed text, and changes nothing else: the
 * draft route refuses a save that changes anything more (`twin_fixed`), and
 * `domain/reports/qeeg/twin.ts` is the rule it is held to. An Arabic half
 * emptied is none; an English half is never emptied, because an English
 * report is never left without words where the first report had some.
 *
 * Pure, as the form's other helpers are: it reads the content and returns new
 * values.
 */

export type TypedText = {
  /** A key of its own, for the screen. */
  key: string;
  /** What it is, in English: "the summary", "your own key finding “…”". */
  of: string;
  /** The English it is a version of, as the first report printed it. */
  english: string;
  /** The half of the language asked for, as it stands; null when none is given. */
  value: string | null;
  most: number;
  multiline: boolean;
  /** `content` with that half written, or cleared with null. */
  set: (content: QeegContent, text: string | null) => QeegContent;
};

type Lists = 'findings' | 'focus' | 'recommendations' | 'benefits';

const LIST_WORDS: Readonly<Record<Lists, string>> = Object.freeze({
  findings: 'key finding',
  focus: 'area of focus',
  recommendations: 'recommendation',
  benefits: 'benefit',
});

const LISTS: readonly Lists[] = ['findings', 'focus', 'recommendations', 'benefits'];

function halfOf(text: Bilingual, locale: Locale): string | null {
  return locale === 'ar' ? text.ar : text.en;
}

function withHalf(text: Bilingual, locale: Locale, value: string | null): Bilingual {
  if (locale === 'ar') return { en: text.en, ar: value };
  return { en: value === null || value.trim() === '' ? text.en : value, ar: text.ar };
}

function richHalf(text: BilingualRich, locale: Locale): RichText | null {
  return locale === 'ar' ? text.ar : text.en;
}

function withRichHalf(text: BilingualRich, locale: Locale, value: string | null): BilingualRich {
  if (locale === 'ar') {
    return {
      en: text.en,
      ar: value === null ? null : retype(text.ar ?? { text: '', marks: [] }, value),
    };
  }
  if (value === null || value.trim() === '') return text;
  return { en: retype(text.en, value), ar: text.ar };
}

function ordered<T extends { readonly position: number }>(
  items: Readonly<Record<string, T>>,
): [string, T][] {
  return Object.entries(items).sort(([, a], [, b]) => a.position - b.position);
}

/** `content` with one item of one list replaced. */
function withItem(
  content: QeegContent,
  list: Lists,
  key: string,
  change: (item: CustomItem & { position: number }) => CustomItem & { position: number },
): QeegContent {
  const picked = content[list] as Picked<string>;
  const item = picked.custom[key];
  if (!item) return content;
  return { ...content, [list]: { ...picked, custom: { ...picked.custom, [key]: change(item) } } };
}

export function typedTextsOf(content: QeegContent, locale: Locale): TypedText[] {
  const texts: TypedText[] = [];

  for (const list of LISTS) {
    const picked = content[list] as Picked<string>;
    for (const [key, item] of ordered(picked.custom)) {
      if (!item.chosen) continue;
      const name = `your own ${LIST_WORDS[list]} “${item.label.en}”`;
      texts.push({
        key: `${list}.${key}.label`,
        of: name,
        english: item.label.en,
        value: halfOf(item.label, locale),
        most: LIMITS.label,
        multiline: false,
        set: (was, text) =>
          withItem(was, list, key, (at) => ({ ...at, label: withHalf(at.label, locale, text) })),
      });
      if (item.note !== null) {
        texts.push({
          key: `${list}.${key}.note`,
          of: `what ${name} advises`,
          english: item.note.en,
          value: halfOf(item.note, locale),
          most: LIMITS.note,
          multiline: true,
          set: (was, text) =>
            withItem(was, list, key, (at) =>
              at.note === null ? at : { ...at, note: withHalf(at.note, locale, text) },
            ),
        });
      }
    }
  }

  for (const [key, map] of ordered(content.maps)) {
    if (map.caption === null) continue;
    texts.push({
      key: `maps.${key}.caption`,
      of: `the label of map ${map.position + 1}`,
      english: map.caption.en,
      value: halfOf(map.caption, locale),
      most: LIMITS.caption,
      multiline: false,
      set: (was, text) => {
        const at = was.maps[key];
        if (!at || at.caption === null) return was;
        return {
          ...was,
          maps: { ...was.maps, [key]: { ...at, caption: withHalf(at.caption, locale, text) } },
        };
      },
    });
  }

  for (const dimension of DIMENSION_IDS) {
    const evidence = content.dashboard[dimension].evidence;
    if (evidence === null) continue;
    texts.push({
      key: `dashboard.${dimension}.evidence`,
      of: `the evidence for ${phrase(`dimension.${dimension}.title`, content.edition, 'en')}`,
      english: evidence.en,
      value: halfOf(evidence, locale),
      most: LIMITS.evidence,
      multiline: true,
      set: (was, text) => {
        const at = was.dashboard[dimension];
        if (at.evidence === null) return was;
        return {
          ...was,
          dashboard: {
            ...was.dashboard,
            [dimension]: { ...at, evidence: withHalf(at.evidence, locale, text) },
          },
        } as QeegContent;
      },
    });
  }

  texts.push({
    key: 'summary',
    of: 'the summary',
    english: content.summary.en.text,
    value: richHalf(content.summary, locale)?.text ?? null,
    most: LIMITS.summaryTyped,
    multiline: true,
    set: (was, text) => ({ ...was, summary: withRichHalf(was.summary, locale, text) }),
  });

  if (content.edition === 'follow-up') {
    for (const [key, tile] of ordered(content.change.tiles)) {
      texts.push({
        key: `change.tiles.${key}.caption`,
        of: `the headline “${tile.caption.en}”`,
        english: tile.caption.en,
        value: halfOf(tile.caption, locale),
        most: LIMITS.caption,
        multiline: false,
        set: (was, text) => {
          if (was.edition !== 'follow-up') return was;
          const at = was.change.tiles[key];
          if (!at) return was;
          return {
            ...was,
            change: {
              ...was.change,
              tiles: {
                ...was.change.tiles,
                [key]: { ...at, caption: withHalf(at.caption, locale, text) },
              },
            },
          };
        },
      });
    }
    texts.push({
      key: 'change.summary',
      of: 'what has changed',
      english: content.change.summary.en.text,
      value: richHalf(content.change.summary, locale)?.text ?? null,
      most: LIMITS.summaryTyped,
      multiline: true,
      set: (was, text) =>
        was.edition === 'follow-up'
          ? {
              ...was,
              change: { ...was.change, summary: withRichHalf(was.change.summary, locale, text) },
            }
          : was,
    });
  }

  return texts;
}
