import { mapsInOrder } from '../../../../domain/reports/qeeg/maps';
import type { QeegContent } from '../../../../domain/reports/qeeg/types';
import type { QeegLayoutNotes } from '../../../api/reports/schema';
import { SECTION_TITLES } from './sections';

/**
 * What the form says beside the Preview button about the pages it just drew
 * (docs/SPEC/reports-qeeg.md section 12, point 10, and section 9, point 4):
 * how many pages, the scale the dashboard was drawn at, anything that runs
 * over, any character the typeface cannot draw, and how sharply each map will
 * print where it sits.
 *
 * **The server works it out; this only says it.** The figures come from the
 * preview's own `x-report-layout` header, laid by the same pages that are
 * filed, so the form never guesses at a size or a scale of its own.
 *
 * **The spec's own words for a map** (section 9, point 4): below 220 dots to
 * the inch it will print a little soft; below 140 it will look pixelated and
 * is worth exporting again. A map is named as the form lists it, by its place
 * and the condition or label she gave it.
 *
 * **A character by its code point.** The header carries ASCII; a character
 * is shown beside its code point when it is a Latin one, and by its code
 * point alone otherwise, so the console shows no other script
 * (tests/lint/console-is-english.test.ts).
 */

const QUALITY_WORDS: Readonly<Record<string, string>> = Object.freeze({
  good: 'will print sharply',
  fair: 'will print a little soft',
  poor: 'will look pixelated and is worth exporting again',
});

const CONDITION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  eyes_open: 'eyes open',
  eyes_closed: 'eyes closed',
});

/** A code point, with its character before it when the character is a Latin one. */
function characterWords(code: string): string {
  const value = Number.parseInt(code.replace(/^U\+/, ''), 16);
  if (!Number.isFinite(value) || value >= 0x0590 || value < 0x20) return code;
  return `${String.fromCodePoint(value)} (${code})`;
}

function printWords(quality: string, dpi: number): string {
  return `${QUALITY_WORDS[quality] ?? QUALITY_WORDS['good'] ?? ''} (about ${dpi} dots to the inch)`;
}

export function layoutLines(notes: QeegLayoutNotes, content: QeegContent): string[] {
  const lines: string[] = [notes.pages === 1 ? '1 page.' : `${notes.pages} pages.`];
  lines.push(
    notes.dashboardScale < 1
      ? `The dashboard is drawn at ${Math.round(notes.dashboardScale * 100)}% of its size to fit its page.`
      : 'The dashboard fits its page at full size.',
  );
  if (notes.overflowing.length > 0) {
    lines.push(`Runs past the foot of its page: ${notes.overflowing.join(', ')}.`);
  }
  if (notes.unprintable.length > 0) {
    const more = notes.unprintableMore > 0 ? ` and ${notes.unprintableMore} more` : '';
    lines.push(
      `The typeface cannot draw ${notes.unprintable.map(characterWords).join(', ')}${more}. ` +
        'Those characters would be left out of the page.',
    );
  }
  const listed = mapsInOrder(content);
  for (const map of notes.maps) {
    const place = listed.findIndex((each) => each.entry.figureId === map.figureId);
    const entry = listed[place]?.entry;
    const named =
      entry === undefined
        ? 'A map'
        : `Map ${place + 1}, ${
            entry.condition !== null
              ? (CONDITION_WORDS[entry.condition] ?? entry.condition)
              : (entry.caption?.en ?? 'with no label')
          }`;
    lines.push(`${named}, ${printWords(map.quality, map.dpi)}.`);
  }
  for (const pair of notes.pairs) {
    const condition = CONDITION_WORDS[pair.condition] ?? pair.condition;
    const side = pair.side === 'earlier' ? 'the earlier map' : 'the later map';
    lines.push(
      `${SECTION_TITLES.change}, ${condition}, ${side}, ${printWords(pair.quality, pair.dpi)}.`,
    );
  }
  return lines;
}
