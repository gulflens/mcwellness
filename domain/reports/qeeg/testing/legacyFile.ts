/**
 * An invented report file of the practice's old tool, for the tests of
 * bringing a past record in: the placement helper's, the import routes' and
 * the screen's.
 *
 * **Invented, every byte.** The old tool's folders on this machine hold a
 * real client's report, and they are never opened (brief R). This file is
 * built from the reader's own test fixtures' shape (`legacy/read.test.ts`):
 * version 1, the person under `LEGACY_SUBJECT_KEY`, ticks by position, two
 * maps and an empty card. The one name is made from `db/seed/names.ts`; the
 * pictures are placeholders a test replaces with bytes of its own making.
 *
 * **For tests only.** Three suites build the same file, and a file copied
 * three times drifts; a test file cannot be imported by another without
 * running its tests twice, so it lives here, as `reports.ts` does. Nothing
 * that reaches a page imports it.
 */

import { FAMILY_NAMES, GIVEN_NAMES } from '../../../../db/seed/names';
import { LEGACY_SUBJECT_KEY } from '../legacy/keys';
import { readLegacyReport } from '../legacy/read';

const given = GIVEN_NAMES[5] ?? { en: 'Ember', ar: 'جمرة' };
const family = FAMILY_NAMES[6] ?? { en: 'Meadow', ar: 'مرج' };

/** The name the invented file types for its person, in English and in Arabic. */
export const LEGACY_NAME = Object.freeze({
  en: `${given.en} ${family.en}`,
  ar: `${given.ar} ${family.ar}`,
});

/** A picture's place in a file: a one-pixel PNG, so the reader keeps it. Bytes a test makes itself replace it. */
export const LEGACY_PICTURE = 'data:image/png;base64,iVBORw0KGgo=';

/** A row of ticks, `length` long, ticked at `at`. */
function ticks(length: number, at: readonly number[]): boolean[] {
  return Array.from({ length }, (_, i) => at.includes(i));
}

export type LegacyFile = Record<string, unknown>;

/**
 * A whole report as the old tool saved it. `over` replaces keys of the file;
 * `person` replaces keys of the person it typed.
 */
export function buildLegacyFile(
  over: LegacyFile = {},
  person: Record<string, unknown> = {},
): LegacyFile {
  return {
    v: 1,
    [LEGACY_SUBJECT_KEY]: {
      name: LEGACY_NAME.en,
      nameAr: LEGACY_NAME.ar,
      age: '34',
      gender: 'Female',
      hand: 'Right',
      eyes: 'Closed and Open',
      date: '2026-03-14',
      assess: 'Initial QEEG',
      ...person,
    },
    kf: ticks(10, [0, 5]),
    fa: ticks(11, [2]),
    customKF: [{ text: 'Her own finding', checked: true }],
    customFA: [],
    customRC: [],
    customBN: [],
    maps: [
      { label: 'EO: Eyes Open', name: 'open.png', img: { url: LEGACY_PICTURE, w: 40, h: 30 } },
      { label: 'EC: Eyes Closed', name: 'closed.png', img: { url: LEGACY_PICTURE, w: 40, h: 30 } },
      { label: 'EO: Eyes Open', name: '', img: null },
    ],
    bands: [
      { lvl: 'Increased', regions: ticks(9, [0]) },
      { lvl: 'Reduced', regions: ticks(9, [4]) },
      { lvl: 'Within normal limits', regions: ticks(9, []) },
      { lvl: 'Increased', regions: ticks(9, [8]) },
      { lvl: 'Reduced', regions: ticks(9, [1]) },
    ],
    links: {
      conn: { lvl: 'mixed', regions: ticks(9, [0]) },
      asym: { lvl: 'right', regions: ticks(9, [4]) },
      phase: { lvl: 'altered', regions: ticks(9, [8]) },
    },
    dims: [
      { score: '6', evid: 'Steady across the recording.' },
      { score: '5', evid: '' },
      { score: '7', evid: '' },
      { score: '4', evid: '' },
      { score: '8', evid: '' },
      // The old tool printed 5 for a score nobody set: the reader notes it.
      { score: '', evid: '' },
    ],
    rc: ticks(6, [0, 3]),
    summary: 'A settled first recording.',
    bn: ticks(9, [0, 4]),
    sessions: '20 Sessions',
    approach: '1',
    signer: 'Willow Harbour',
    role: 'Practitioner',
    signature: null,
    ...over,
  };
}

/** The file as the screen reads it, or a thrown error when the reader refuses it. */
export function readLegacyFile(file: unknown, sourceSha256: string) {
  const read = readLegacyReport(file, sourceSha256);
  if (!read.ok) throw new Error(`The invented file was refused: ${read.reason}`);
  return read;
}
