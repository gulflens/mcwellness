import { describe, expect, it } from 'vitest';
import { validateQeegContent } from '../shape';
import { IMPORT_NOTE_CODES } from '../types';
import { LEGACY_SUBJECT_KEY } from './keys';
import { readLegacyReport } from './read';

/**
 * The old-file reader and the shape were built apart, by two builders. What
 * the reader hands back is stored, and what is stored is held to the shape,
 * so every file the reader accepts must give content the shape accepts. A
 * change to either half is caught here by the other.
 *
 * Every fixture is built here, in the old tool's version 1 format. The names
 * come from `db/seed/names.ts`.
 */

const SHA = '1'.repeat(64);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

type OldFile = Record<string, unknown>;

function ticks(length: number, at: readonly number[] = []): boolean[] {
  return Array.from({ length }, (_, i) => at.includes(i));
}

function fullFile(stage = 'Initial QEEG'): OldFile {
  return {
    v: 1,
    [LEGACY_SUBJECT_KEY]: {
      name: 'Hazel Meadow',
      nameAr: 'بندق مرج',
      age: '34',
      gender: 'Female',
      hand: 'Right',
      eyes: 'Closed and Open',
      date: '2026-03-14',
      assess: stage,
    },
    kf: ticks(10, [0, 5, 9]),
    fa: ticks(11, [0, 5, 10]),
    customKF: [{ text: 'Her own finding', checked: true, textAr: 'ملاحظتها' }],
    customFA: [{ text: 'Evenings', checked: false }],
    customRC: [{ text: 'Walk daily', note: 'Twenty minutes outdoors.', checked: true }],
    customBN: [{ text: 'Steadier mornings', checked: true }],
    maps: [
      { label: 'EO: Eyes Open', name: 'open.png', img: { url: PNG, w: 800, h: 600 } },
      { label: 'Her own view', name: 'own.png', img: { url: PNG, w: 640, h: 480 } },
    ],
    bands: [
      { lvl: 'Increased', regions: ticks(9, [0]) },
      { lvl: 'Reduced', regions: ticks(9, [4]) },
      { lvl: 'Within normal limits', regions: ticks(9) },
      { lvl: 'Increased', regions: ticks(9, [8]) },
      { lvl: 'Reduced', regions: ticks(9, [0, 4, 8]) },
    ],
    links: {
      conn: { lvl: 'mixed', regions: ticks(9, [0]) },
      asym: { lvl: 'right', regions: ticks(9, [4]) },
      phase: { lvl: 'altered', regions: ticks(9, [8]) },
    },
    dims: [
      { score: '1', evid: 'Slow frontal activity.', evidAr: 'نشاط بطيء' },
      { score: '2', evid: '' },
      { score: '3', evid: '' },
      { score: '4', evid: '' },
      { score: '8', evid: '' },
      { score: '10', evid: '' },
    ],
    rc: ticks(6, [0, 3, 5]),
    summary: 'Plain and bold',
    summaryRich: JSON.stringify({
      ops: [
        { insert: 'Plain and ' },
        { insert: 'bold', attributes: { bold: true, underline: true } },
        { insert: '\n' },
      ],
    }),
    summaryAr: 'ملخص',
    bn: ticks(9, [0, 4, 8]),
    sessions: '30 Sessions',
    approach: '1',
    signer: 'Willow Harbour',
    role: 'Practitioner',
    signature: null,
  };
}

/** A report as the old tool saved it before anyone touched a thing. */
function blankFile(): OldFile {
  return {
    v: 1,
    [LEGACY_SUBJECT_KEY]: {
      name: '',
      age: '',
      gender: '',
      hand: '',
      eyes: '',
      date: '',
      assess: 'Initial QEEG',
    },
    kf: ticks(10),
    fa: ticks(11),
    customKF: [],
    customFA: [],
    customRC: [],
    customBN: [],
    maps: [
      { label: 'EO: Eyes Open', name: '', img: null },
      { label: 'EC: Eyes Closed', name: '', img: null },
    ],
    bands: Array.from({ length: 5 }, () => ({ lvl: '', regions: ticks(9) })),
    links: {
      conn: { lvl: '', regions: ticks(9) },
      asym: { lvl: '', regions: ticks(9) },
      phase: { lvl: '', regions: ticks(9) },
    },
    dims: Array.from({ length: 6 }, () => ({ score: '5', evid: '' })),
    rc: ticks(6),
    summary: '',
    summaryRich: JSON.stringify({ ops: [{ insert: '\n' }] }),
    bn: ticks(9),
    sessions: '',
    approach: '',
    signer: '',
    role: '',
    signature: null,
  };
}

/** Every typed field of a full file, filled with text the old tool never cleaned. */
function hostileFile(): OldFile {
  const spaced = `${' '.repeat(160)}x`;
  const control = 'a\u0000b‮c';
  const padded = '  padded  ';
  const base = fullFile();
  return {
    ...base,
    [LEGACY_SUBJECT_KEY]: {
      ...(base[LEGACY_SUBJECT_KEY] as object),
      name: control,
      nameAr: control,
      age: padded,
    },
    customKF: [
      { text: spaced, textAr: control, checked: true },
      { text: control, checked: true },
      { text: padded, textAr: padded, checked: false },
    ],
    customRC: [{ text: control, note: spaced, noteAr: control, checked: true }],
    maps: [{ label: control, name: '', img: { url: PNG, w: 10, h: 10 } }],
    dims: [
      { score: '5', evid: control, evidAr: spaced },
      { score: '5', evid: padded },
    ],
    summary: control,
    summaryRich: JSON.stringify({
      ops: [
        { insert: `  ${control} ` },
        { insert: 'bold', attributes: { bold: true } },
        { insert: '\u0000\n' },
      ],
    }),
    summaryAr: `${padded}${control}`,
    signer: control,
    role: spaced,
  };
}

function expectMeetsShape(file: OldFile) {
  const read = readLegacyReport(file, SHA);
  if (!read.ok) throw new Error(`the reader refused the file: ${read.reason}`);
  const answer = validateQeegContent(read.content);
  if (!answer.ok) expect(answer.refusals).toEqual([]);
  expect(answer).toEqual({ ok: true, content: read.content });
}

describe('what the old-file reader hands back meets the shape', () => {
  it('for a full file', () => {
    expectMeetsShape(fullFile());
  });

  it('for a file with a person and nothing else', () => {
    expectMeetsShape({ [LEGACY_SUBJECT_KEY]: { name: 'Hazel Meadow' } });
  });

  it('for a blank as the old tool saved one', () => {
    expectMeetsShape(blankFile());
  });

  it('for a file the old tool called a follow-up', () => {
    expectMeetsShape(fullFile('Follow-up QEEG'));
  });

  it('for a file the old tool called final', () => {
    expectMeetsShape(fullFile('Final QEEG'));
  });

  it('for a file whose typed text was never cleaned', () => {
    expectMeetsShape(hostileFile());
  });

  it('for a file of a thousand places left out under a label of her own', () => {
    const maps = Array.from({ length: 1000 }, () => ({ label: 'Her own view', img: null }));
    expectMeetsShape({ ...fullFile(), maps });
  });

  it('for a file made to earn every kind of note at once', () => {
    const long = 'z'.repeat(500);
    const items = (withNote: boolean) =>
      Array.from({ length: 14 }, () => ({
        text: long,
        textAr: long,
        ...(withNote ? { note: long, noteAr: long } : {}),
        checked: true,
      }));
    const base = fullFile();
    const file: OldFile = {
      ...base,
      [LEGACY_SUBJECT_KEY]: {
        ...(base[LEGACY_SUBJECT_KEY] as object),
        name: long,
        nameAr: long,
        age: long,
        gender: long,
        hand: 'Sideways',
        eyes: 'Squinting',
        date: '2026-02-30',
        assess: 'Midway',
      },
      kf: ticks(14, [13]),
      fa: ticks(14, [13]),
      rc: ticks(14, [13]),
      bn: ticks(14, [13]),
      customKF: items(false),
      customFA: items(false),
      customRC: items(true),
      customBN: items(false),
      maps: [
        ...Array.from({ length: 1000 }, () => ({ label: 'Her own view', img: null })),
        ...Array.from({ length: 12 }, () => ({ label: long, img: { url: PNG, w: 1, h: 1 } })),
      ],
      bands: Array.from({ length: 7 }, () => ({ lvl: 'Loud', regions: ticks(12, [11]) })),
      links: {
        conn: { lvl: 'odd', regions: ticks(12) },
        asym: { lvl: 'odd', regions: ticks(12) },
        phase: { lvl: 'odd', regions: ticks(12) },
      },
      dims: [
        ...Array.from({ length: 3 }, () => ({ evid: long, evidAr: long })),
        ...Array.from({ length: 5 }, () => ({ score: '40', evid: long, evidAr: long })),
      ],
      summary: long,
      summaryRich: '{"ops": [',
      summaryAr: long,
      summaryRichAr: JSON.stringify({
        ops: [
          { insert: 'a\u0000' },
          ...Array.from({ length: 300 }, (_, i) => ({
            insert: 'b',
            attributes: i % 2 === 0 ? { bold: true } : { underline: true },
          })),
          { insert: 'c', attributes: { color: 'red', italic: true, link: 'https://example.com' } },
          { insert: { image: 'x' } },
          { insert: long.repeat(10) },
          { insert: '\n' },
        ],
      }),
      sessions: 'many',
      approach: '9',
      signer: long,
      role: long,
      signature: { url: PNG, name: 'sig.png' },
    };
    const read = readLegacyReport(file, SHA);
    if (!read.ok) throw new Error(read.reason);
    expect([...new Set(read.notes.map((note) => note.code))].sort()).toEqual(
      [...IMPORT_NOTE_CODES].sort(),
    );
    expectMeetsShape(file);
  });
});
