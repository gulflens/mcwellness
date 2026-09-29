import { describe, expect, it } from 'vitest';
import { validateQeegContent } from '../shape';
import { LIMITS, type ImportNote, type QeegInitial } from '../types';
import { DRAWS_NOTHING } from '../testing/drawsNothing';
import { LEGACY_SUBJECT_KEY } from './keys';
import { readLegacyReport } from './read';

/**
 * Every fixture is an object in the old tool's version 1 format, built here.
 * The one name in it comes from `db/seed/names.ts`.
 */

const SHA = '0'.repeat(64);
const NAME = 'Hazel Meadow';
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

/** A row of ticks, `length` long, ticked at `at`. */
function ticks(length: number, at: readonly number[]): boolean[] {
  return Array.from({ length }, (_, i) => at.includes(i));
}

type OldFile = Record<string, unknown>;

/** A whole report as the old tool saved it: first, middle and last of every list ticked. */
function fullFile(): OldFile {
  return {
    v: 1,
    [LEGACY_SUBJECT_KEY]: {
      name: NAME,
      nameAr: 'بندق مرج',
      age: '34',
      gender: 'Female',
      hand: 'Right',
      eyes: 'Closed and Open',
      date: '2026-03-14',
      assess: 'Initial QEEG',
    },
    kf: ticks(10, [0, 5, 9]),
    fa: ticks(11, [0, 5, 10]),
    customKF: [{ text: 'Her own finding', checked: true, textAr: 'ملاحظتها' }],
    customFA: [],
    customRC: [{ text: 'Walk daily', note: 'Twenty minutes outdoors.', checked: false }],
    customBN: [],
    maps: [
      { label: 'EO: Eyes Open', name: 'open.png', img: { url: PNG, w: 800, h: 600 } },
      { label: 'EC: Eyes Closed', name: 'closed.png', img: { url: PNG, w: 640, h: 480 } },
      { label: 'EO: Eyes Open', name: '', img: null },
      { label: 'EC: Eyes Closed', name: '', img: null },
    ],
    bands: [
      { lvl: 'Increased', regions: ticks(9, [0]) },
      { lvl: 'Reduced', regions: ticks(9, [4]) },
      { lvl: 'Within normal limits', regions: ticks(9, []) },
      { lvl: 'Increased', regions: ticks(9, [8]) },
      { lvl: 'Reduced', regions: ticks(9, [0, 4, 8]) },
    ],
    links: {
      conn: { lvl: 'mixed', regions: ticks(9, [0]) },
      asym: { lvl: 'right', regions: ticks(9, [4]) },
      phase: { lvl: 'altered', regions: ticks(9, [8]) },
    },
    dims: [
      { score: '1', evid: 'Slow frontal activity.' },
      { score: '2', evid: '' },
      { score: '3', evid: '' },
      { score: '4', evid: '', evidAr: 'نص' },
      { score: '8', evid: '' },
      { score: '10', evid: '' },
    ],
    rc: ticks(6, [0, 3, 5]),
    summary: 'Plain and bold',
    summaryRich: JSON.stringify({
      ops: [
        { insert: 'Plain and ' },
        { insert: 'bold', attributes: { bold: true } },
        { insert: '\n' },
      ],
    }),
    bn: ticks(9, [0, 4, 8]),
    sessions: '30 Sessions',
    customSessions: null,
    approach: '1',
    signer: 'Willow Harbour',
    role: 'Practitioner',
    signature: null,
  };
}

/** The same file with some of its keys replaced. */
function withFile(changes: OldFile): OldFile {
  return { ...fullFile(), ...changes };
}

function withSubject(changes: Record<string, unknown>): OldFile {
  const base = fullFile();
  return { ...base, [LEGACY_SUBJECT_KEY]: { ...(base[LEGACY_SUBJECT_KEY] as object), ...changes } };
}

function readOk(file: unknown) {
  const result = readLegacyReport(file, SHA);
  if (!result.ok) throw new Error(`expected the file to be read, was refused: ${result.reason}`);
  return result;
}

function content(file: unknown): QeegInitial {
  return readOk(file).content;
}

function notes(file: unknown): readonly ImportNote[] {
  return readOk(file).notes;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

describe('a full report from the old tool', () => {
  it('carries every choice under its right name, first, middle and last', () => {
    const c = content(fullFile());
    expect(c.findings.chosen).toEqual([
      'brainwave_dysregulation',
      'increased_stress_response',
      'reduced_mental_energy',
    ]);
    expect(c.focus.chosen).toEqual([
      'brainwave_regulation',
      'emotional_regulation',
      'performance_optimisation',
    ]);
    expect(c.recommendations.chosen).toEqual([
      'mental_energy',
      'stress_regulation',
      'decision_making',
    ]);
    expect(c.benefits.chosen).toEqual(['attention_focus', 'mental_energy', 'recovery']);
  });

  it('reads each band by its position, with its regions by theirs', () => {
    const c = content(fullFile());
    expect(c.bands).toEqual({
      delta: { level: 'increased', regions: ['frontal'] },
      theta: { level: 'reduced', regions: ['occipital'] },
      alpha: { level: 'within_normal_limits', regions: [] },
      beta: { level: 'increased', regions: ['widespread'] },
      high_beta: { level: 'reduced', regions: ['frontal', 'occipital', 'widespread'] },
    });
  });

  it('reads each measure by the key the old file gave it', () => {
    const c = content(fullFile());
    expect(c.connectivity).toEqual({
      connectivity: { level: 'mixed', regions: ['frontal'] },
      asymmetry: { level: 'right', regions: ['occipital'] },
      phase_lag: { level: 'altered', regions: ['widespread'] },
    });
  });

  it('reads each score by its position', () => {
    const c = content(fullFile());
    expect(c.dashboard.mental_energy).toEqual({
      score: 1,
      evidence: { en: 'Slow frontal activity.', ar: null },
    });
    expect(c.dashboard.attention_focus.score).toBe(2);
    expect(c.dashboard.cognitive_flexibility.score).toBe(3);
    expect(c.dashboard.stress_regulation).toEqual({ score: 4, evidence: { en: '', ar: 'نص' } });
    expect(c.dashboard.recovery_capacity).toEqual({ score: 8, evidence: null });
    expect(c.dashboard.decision_making.score).toBe(10);
  });

  it('reads each approach by its position', () => {
    expect(content(withFile({ approach: '0' })).plan.approach).toBe('calming');
    expect(content(withFile({ approach: '1' })).plan.approach).toBe('stabilising');
    expect(content(withFile({ approach: '2' })).plan.approach).toBe('calming_and_stabilising');
  });

  it('reads the recording and the programme', () => {
    const c = content(fullFile());
    expect(c.recording).toEqual({
      recordedOn: '2026-03-14',
      eyes: 'closed_and_open',
      handedness: 'right',
    });
    expect(c.plan).toEqual({ sessions: 30, approach: 'stabilising' });
  });

  it('carries what she added to a list, in order, keyed c0 onwards', () => {
    const c = content(fullFile());
    expect(c.findings.custom).toEqual({
      c0: {
        label: { en: 'Her own finding', ar: 'ملاحظتها' },
        note: null,
        chosen: true,
        position: 0,
      },
    });
    expect(c.recommendations.custom).toEqual({
      c0: {
        label: { en: 'Walk daily', ar: null },
        note: { en: 'Twenty minutes outdoors.', ar: null },
        chosen: false,
        position: 0,
      },
    });
    expect(c.focus.custom).toEqual({});
  });

  it('carries the formatted summary with its marks', () => {
    const c = content(fullFile());
    expect(c.summary).toEqual({
      en: { text: 'Plain and bold', marks: [{ from: 10, to: 14, bold: true }] },
      ar: null,
    });
  });

  it('is a first report of the app, with nothing gathered and no maps stored', () => {
    const c = content(fullFile());
    expect(c.kind).toBe('qeeg');
    expect(c.edition).toBe('initial');
    expect(c.stage).toBe('initial');
    expect(c.schema).toBe(1);
    expect(c.wording).toBe(1);
    expect(c.subject).toEqual({ nameAr: null, ageYears: null, sex: null });
    expect(c.maps).toEqual({});
  });

  it('says where it came from, and who the old report named as its signer', () => {
    const result = readOk(fullFile());
    expect(result.content.provenance).toEqual({
      origin: 'legacy_tool',
      format: 'qeeg.json/1',
      sourceSha256: SHA,
      notes: [],
      asPrinted: { signerName: 'Willow Harbour', signerRole: 'Practitioner' },
    });
    expect(result.notes).toEqual([]);
  });

  it('hands over the maps it held, in order, for uploading', () => {
    expect(readOk(fullFile()).images).toEqual([
      {
        key: 'map-0',
        position: 0,
        dataUrl: PNG,
        widthPx: 800,
        heightPx: 600,
        condition: 'eyes_open',
        caption: null,
      },
      {
        key: 'map-1',
        position: 1,
        dataUrl: PNG,
        widthPx: 640,
        heightPx: 480,
        condition: 'eyes_closed',
        caption: null,
      },
    ]);
  });
});

describe('what the practitioner called it', () => {
  it('reads a follow-up from the old tool as a first-report edition that says it was a follow-up', () => {
    const c = content(withSubject({ assess: 'Follow-up QEEG' }));
    expect(c.edition).toBe('initial');
    expect(c.stage).toBe('follow_up');
  });

  it('reads a final assessment the same way', () => {
    const c = content(withSubject({ assess: 'Final QEEG' }));
    expect(c.edition).toBe('initial');
    expect(c.stage).toBe('final');
  });
});

describe('the person the old file named', () => {
  it('puts the name, the Arabic name, age and sex beside the content, never in it', () => {
    const result = readOk(fullFile());
    expect(result.asTyped).toEqual({ name: NAME, nameAr: 'بندق مرج', age: '34', sex: 'Female' });
    const serialised = JSON.stringify(result.content);
    expect(serialised).not.toContain(NAME);
    expect(serialised).not.toContain('Hazel');
    expect(serialised).not.toContain('بندق');
  });

  it('reads an age the old file held as a number as the text it would have shown', () => {
    expect(readOk(withSubject({ age: 34 })).asTyped.age).toBe('34');
  });

  it('reads an absent name, Arabic name, age and sex as empty', () => {
    const file = withFile({ [LEGACY_SUBJECT_KEY]: {} });
    expect(readOk(file).asTyped).toEqual({ name: '', nameAr: '', age: '', sex: '' });
  });
});

describe('nothing typed reaches a note', () => {
  it('never puts what was typed into a note', () => {
    const MARK = 'QQMARKERQQ';
    const long = MARK.repeat(500);
    const custom = [{ text: long, note: long, textAr: long, noteAr: long, checked: true }];
    const file = {
      v: 1,
      [LEGACY_SUBJECT_KEY]: {
        name: long,
        nameAr: long,
        age: long,
        gender: long,
        hand: long,
        eyes: long,
        date: long,
        assess: long,
      },
      kf: ticks(12, [0, 11]),
      fa: ticks(11, [1]),
      customKF: [...custom, ...Array.from({ length: 14 }, () => custom[0])],
      customFA: custom,
      customRC: custom,
      customBN: custom,
      maps: [
        { label: long, name: long, img: { url: PNG, w: 1, h: 1 } },
        { label: long, name: long, img: null },
      ],
      bands: [{ lvl: long, regions: ticks(12, [0]) }],
      links: { conn: { lvl: long, regions: [] } },
      dims: [{ score: long, evid: long, evidAr: long }, { score: '99' }],
      rc: [],
      summary: long,
      summaryRich: long,
      summaryAr: long,
      summaryRichAr: JSON.stringify({
        ops: [{ insert: long, attributes: { color: long, italic: true } }],
      }),
      bn: [],
      sessions: long,
      customSessions: long,
      approach: long,
      signer: long,
      role: long,
      signerAr: long,
      roleAr: long,
      signature: { url: PNG, name: long },
    };
    const found = notes(file);
    expect(found.length).toBeGreaterThan(10);
    expect(JSON.stringify(found)).not.toContain(MARK);
    for (const note of found) {
      expect(note.at === null || note.at.length < 60).toBe(true);
    }
  });
});

describe('what the reader tolerates, following the old tool', () => {
  it('reads a tick list shorter than its list, or none, as unticked, without a note', () => {
    const short = readOk(withFile({ kf: [true, false], fa: undefined, bn: 'none' }));
    expect(short.content.findings.chosen).toEqual(['brainwave_dysregulation']);
    expect(short.content.focus.chosen).toEqual([]);
    expect(short.content.benefits.chosen).toEqual([]);
    expect(short.notes).toEqual([]);
  });

  it('counts only a tick that is true', () => {
    const c = content(withFile({ kf: [1, 'true', true, null] }));
    expect(c.findings.chosen).toEqual(['reduced_cognitive_efficiency']);
  });

  it('ignores the extra positions of a longer tick list, and says where', () => {
    const result = readOk(withFile({ kf: ticks(12, [9, 10, 11]) }));
    expect(result.content.findings.chosen).toEqual(['reduced_mental_energy']);
    expect(result.notes).toEqual([{ code: 'extra_positions_ignored', at: 'findings' }]);
  });

  it('ignores the extra positions of a longer region list', () => {
    const bands = [...(fullFile()['bands'] as object[])];
    bands[0] = { lvl: 'Increased', regions: ticks(10, [0, 9]) };
    const result = readOk(withFile({ bands }));
    expect(result.content.bands.delta.regions).toEqual(['frontal']);
    expect(result.notes).toEqual([{ code: 'extra_positions_ignored', at: 'bands.delta.regions' }]);
  });

  it('ignores a sixth band', () => {
    const bands = [...(fullFile()['bands'] as object[]), { lvl: 'Increased', regions: [] }];
    expect(notes(withFile({ bands }))).toEqual([{ code: 'extra_positions_ignored', at: 'bands' }]);
  });

  it('reads a level it has no name for as unset, and says which field', () => {
    const bands = [...(fullFile()['bands'] as object[])];
    bands[3] = { lvl: 'Raised', regions: ticks(9, [0]) };
    const result = readOk(withFile({ bands }));
    expect(result.content.bands.beta).toEqual({ level: null, regions: ['frontal'] });
    expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'bands.beta' }]);
  });

  it('reads a level of a measure it has no name for as unset', () => {
    const links = { ...(fullFile()['links'] as object), asym: { lvl: 'mixed', regions: [] } };
    const result = readOk(withFile({ links }));
    expect(result.content.connectivity.asymmetry).toEqual({ level: null, regions: [] });
    expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'connectivity.asymmetry' }]);
  });

  it('reads a band or measure left blank as unset, without a note', () => {
    const result = readOk(withFile({ bands: [{ lvl: '', regions: [] }], links: {} }));
    expect(result.content.bands.delta).toEqual({ level: null, regions: [] });
    expect(result.content.bands.high_beta).toEqual({ level: null, regions: [] });
    expect(result.content.connectivity.phase_lag).toEqual({ level: null, regions: [] });
    expect(result.notes).toEqual([]);
  });

  it('reads a stage it has no name for as a first assessment, and says so', () => {
    const result = readOk(withSubject({ assess: 'Second QEEG' }));
    expect(result.content.stage).toBe('initial');
    expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'stage' }]);
  });

  it('reads a stage left blank as a first assessment, without a note', () => {
    const result = readOk(withSubject({ assess: '' }));
    expect(result.content.stage).toBe('initial');
    expect(result.notes).toEqual([]);
  });

  it('reads eyes and a hand it has no name for as unset', () => {
    const result = readOk(withSubject({ eyes: 'Half open', hand: 'Both' }));
    expect(result.content.recording.eyes).toBeNull();
    expect(result.content.recording.handedness).toBeNull();
    expect(result.notes).toEqual([
      { code: 'value_not_recognised', at: 'recording.eyes' },
      { code: 'value_not_recognised', at: 'recording.handedness' },
    ]);
  });

  it('reads an approach it has no name for as unset', () => {
    for (const approach of ['3', '-1', 'Calming', 1.5]) {
      const result = readOk(withFile({ approach }));
      expect(result.content.plan.approach).toBeNull();
      expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'plan.approach' }]);
    }
    expect(readOk(withFile({ approach: '' })).notes).toEqual([]);
  });

  it('reads an approach written as a number by its position', () => {
    expect(content(withFile({ approach: 2 })).plan.approach).toBe('calming_and_stabilising');
  });

  it('gives an absent or unreadable score the 5 the old tool printed, and says so', () => {
    const dims = [
      { evid: '' },
      { score: 'seven', evid: '' },
      { score: '', evid: '' },
      { score: '6.5', evid: '' },
      'not a dimension',
    ];
    const result = readOk(withFile({ dims }));
    expect(result.content.dashboard.mental_energy.score).toBe(5);
    expect(result.content.dashboard.attention_focus.score).toBe(5);
    expect(result.content.dashboard.cognitive_flexibility.score).toBe(5);
    expect(result.content.dashboard.stress_regulation.score).toBe(5);
    expect(result.content.dashboard.recovery_capacity.score).toBe(5);
    expect(result.content.dashboard.decision_making.score).toBe(5);
    expect(result.notes).toEqual([
      { code: 'score_defaulted', at: 'dashboard.mental_energy' },
      { code: 'score_defaulted', at: 'dashboard.attention_focus' },
      { code: 'score_defaulted', at: 'dashboard.cognitive_flexibility' },
      { code: 'score_defaulted', at: 'dashboard.stress_regulation' },
      { code: 'score_defaulted', at: 'dashboard.recovery_capacity' },
      { code: 'score_defaulted', at: 'dashboard.decision_making' },
    ]);
  });

  it('reads a score written as a number', () => {
    const dims = [{ score: 7, evid: '' }];
    expect(content(withFile({ dims })).dashboard.mental_energy.score).toBe(7);
  });

  it('clamps a score outside 0 to 10, and says so', () => {
    const dims = [
      { score: '12', evid: '' },
      { score: '-3', evid: '' },
      { score: '0', evid: '' },
      { score: '5', evid: '' },
      { score: '5', evid: '' },
      { score: '5', evid: '' },
    ];
    const result = readOk(withFile({ dims }));
    expect(result.content.dashboard.mental_energy.score).toBe(10);
    expect(result.content.dashboard.attention_focus.score).toBe(0);
    expect(result.content.dashboard.cognitive_flexibility.score).toBe(0);
    expect(result.notes).toEqual([
      { code: 'value_not_recognised', at: 'dashboard.mental_energy' },
      { code: 'value_not_recognised', at: 'dashboard.attention_focus' },
    ]);
  });

  it('ignores a seventh dimension', () => {
    const dims = [...(fullFile()['dims'] as object[]), { score: '3', evid: '' }];
    expect(notes(withFile({ dims }))).toEqual([
      { code: 'extra_positions_ignored', at: 'dashboard' },
    ]);
  });

  it('reads the number of sessions out of its label', () => {
    expect(content(withFile({ sessions: '30 Sessions' })).plan.sessions).toBe(30);
    expect(content(withFile({ sessions: '1 Session' })).plan.sessions).toBe(1);
    expect(content(withFile({ sessions: '200 Sessions' })).plan.sessions).toBe(200);
    expect(content(withFile({ sessions: ' 12 sessions ' })).plan.sessions).toBe(12);
    expect(content(withFile({ sessions: '2 Session' })).plan.sessions).toBe(2);
    expect(notes(withFile({ sessions: '24 Sessions' }))).toEqual([]);
  });

  it('reads sessions not written as N Sessions, or outside 1 to 200, as unset, and says so', () => {
    for (const sessions of [
      'Sessions',
      '0 Sessions',
      '201 Sessions',
      'Ongoing',
      '10 to 15 Sessions',
      'Week 12: 40 Sessions',
      '3.5 Sessions',
      '1000 Sessions',
      '30',
    ]) {
      const result = readOk(withFile({ sessions }));
      expect(result.content.plan.sessions).toBeNull();
      expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'plan.sessions' }]);
    }
  });

  it('reads sessions left blank as unset, without a note', () => {
    const result = readOk(withFile({ sessions: '' }));
    expect(result.content.plan.sessions).toBeNull();
    expect(result.notes).toEqual([]);
  });

  it('leaves out a custom item with no text', () => {
    const customFA = [
      { text: '', checked: true },
      { text: '   ', checked: true },
      { checked: true },
      'not an item',
      { text: 'Kept', checked: true },
    ];
    const result = readOk(withFile({ customFA }));
    expect(result.content.focus.custom).toEqual({
      c0: { label: { en: 'Kept', ar: null }, note: null, chosen: true, position: 0 },
    });
    expect(result.notes).toEqual([]);
  });

  it('keeps a custom item typed in Arabic only, printing her Arabic in either language', () => {
    const customKF = [{ text: '  ', textAr: 'ملاحظتها', checked: true }];
    const result = readOk(withFile({ customKF }));
    expect(result.content.findings.custom).toEqual({
      c0: { label: { en: 'ملاحظتها', ar: 'ملاحظتها' }, note: null, chosen: true, position: 0 },
    });
    expect(result.notes).toEqual([]);
  });

  it('cuts a custom item longer than its limit, and says where', () => {
    const customBN = [{ text: 'a'.repeat(200), checked: true }];
    const result = readOk(withFile({ customBN }));
    expect(result.content.benefits.custom['c0']?.label.en).toBe('a'.repeat(160));
    expect(result.notes).toEqual([{ code: 'text_shortened', at: 'benefits.custom.c0.label.en' }]);
  });

  it('never cuts a letter in half', () => {
    const customBN = [{ text: `${'a'.repeat(159)}🌿`, checked: true }];
    const label = content(withFile({ customBN })).benefits.custom['c0']?.label.en;
    expect(label).toBe('a'.repeat(159));
  });

  it('cuts typed evidence longer than its limit', () => {
    const dims = [{ score: '5', evid: 'e'.repeat(401) }];
    const result = readOk(withFile({ dims }));
    expect(result.content.dashboard.mental_energy.evidence?.en).toHaveLength(400);
    expect(result.notes).toContainEqual({
      code: 'text_shortened',
      at: 'dashboard.mental_energy.evidence.en',
    });
  });

  it('keeps the first twelve custom items of a list, and says so', () => {
    const customKF = Array.from({ length: 15 }, (_, i) => ({ text: `Item ${i}`, checked: true }));
    const result = readOk(withFile({ customKF }));
    const custom = result.content.findings.custom;
    expect(Object.keys(custom)).toEqual(Array.from({ length: 12 }, (_, i) => `c${i}`));
    expect(custom['c11']).toMatchObject({ label: { en: 'Item 11' }, position: 11 });
    expect(result.notes).toEqual([{ code: 'extra_positions_ignored', at: 'findings.custom' }]);
  });

  it('drops the colour and slant of the summary, and says so', () => {
    const summaryRich = JSON.stringify({
      ops: [
        { insert: 'Tinted', attributes: { color: 'purple' } },
        { insert: ' slanted', attributes: { italic: true } },
        { insert: '\n', attributes: { direction: 'rtl' } },
      ],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({ text: 'Tinted slanted', marks: [] });
    expect(result.notes).toEqual([
      { code: 'summary_colour_dropped', at: 'summary.en' },
      { code: 'summary_slant_dropped', at: 'summary.en' },
    ]);
  });

  it('says so when a picture was dropped from the summary', () => {
    const summaryRich = JSON.stringify({
      ops: [
        { insert: 'Before ' },
        { insert: { image: 'data:image/png;base64,AAAA' } },
        { insert: ' after', attributes: { strike: true } },
        { insert: '\n' },
      ],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({ text: 'Before  after', marks: [] });
    expect(result.notes).toEqual([{ code: 'summary_content_dropped', at: 'summary.en' }]);
  });

  it('says so when a bulleted list was dropped from the summary', () => {
    const summaryRichAr = JSON.stringify({
      ops: [{ insert: 'بند' }, { insert: '\n', attributes: { list: 'bullet' } }],
    });
    const result = readOk(withFile({ summaryAr: 'بند', summaryRichAr }));
    expect(result.content.summary.ar).toEqual({ text: 'بند', marks: [] });
    expect(result.notes).toEqual([{ code: 'summary_content_dropped', at: 'summary.ar' }]);
  });

  it('says so when a link was dropped from the summary', () => {
    const summaryRich = JSON.stringify({
      ops: [{ insert: 'Read more', attributes: { link: 'https://example.com' } }, { insert: '\n' }],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({ text: 'Read more', marks: [] });
    expect(result.notes).toEqual([{ code: 'summary_content_dropped', at: 'summary.en' }]);
  });

  it('says so when the formatted summary was only a picture, and reads the plain one', () => {
    const summaryRich = JSON.stringify({
      ops: [{ insert: { image: 'data:image/png;base64,AAAA' } }, { insert: '\n' }],
    });
    const result = readOk(withFile({ summary: 'Plain words', summaryRich }));
    expect(result.content.summary.en).toEqual({ text: 'Plain words', marks: [] });
    expect(result.notes).toEqual([{ code: 'summary_content_dropped', at: 'summary.en' }]);
  });

  it('keeps the first two hundred marks of a summary, and says more were left out', () => {
    const summaryRich = JSON.stringify({
      ops: [
        ...Array.from({ length: 250 }, (_, i) => [
          { insert: 'w', attributes: i % 2 === 0 ? { bold: true } : { underline: true } },
          { insert: ' ' },
        ]).flat(),
        { insert: '\n' },
      ],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en.marks).toHaveLength(LIMITS.marks);
    expect(result.content.summary.en.marks.at(-1)).toEqual({ from: 398, to: 399, underline: true });
    expect(result.notes).toEqual([{ code: 'extra_positions_ignored', at: 'summary.en.marks' }]);
    expect(validateQeegContent(result.content)).toEqual({ ok: true, content: result.content });
  });

  it('falls back to the plain summary when the formatted one cannot be read', () => {
    const result = readOk(withFile({ summary: 'Plain words', summaryRich: '{"ops": [' }));
    expect(result.content.summary.en).toEqual({ text: 'Plain words', marks: [] });
    expect(result.notes).toEqual([{ code: 'summary_formatting_unreadable', at: 'summary.en' }]);
  });

  it('reads the plain summary, without a note, when there is no formatted one', () => {
    const result = readOk(withFile({ summary: 'Only plain', summaryRich: undefined }));
    expect(result.content.summary.en).toEqual({ text: 'Only plain', marks: [] });
    expect(result.notes).toEqual([]);
  });

  it('reads the plain summary when the formatted one is empty, as the old tool printed it', () => {
    const summaryRich = JSON.stringify({ ops: [{ insert: '\n' }] });
    const result = readOk(withFile({ summary: 'Plain again', summaryRich }));
    expect(result.content.summary.en).toEqual({ text: 'Plain again', marks: [] });
  });

  it('reads an Arabic summary beside the English', () => {
    const summaryRichAr = JSON.stringify({
      ops: [{ insert: 'ملخص ' }, { insert: 'مهم', attributes: { bold: true } }, { insert: '\n' }],
    });
    const c = content(withFile({ summaryAr: 'ملخص مهم', summaryRichAr }));
    expect(c.summary.ar).toEqual({ text: 'ملخص مهم', marks: [{ from: 5, to: 8, bold: true }] });
    expect(content(withFile({ summaryAr: 'ملخص' })).summary.ar).toEqual({
      text: 'ملخص',
      marks: [],
    });
  });

  it('cuts a summary longer than its limit, and keeps its marks inside it', () => {
    const summaryRich = JSON.stringify({
      ops: [{ insert: 'x'.repeat(3990) }, { insert: 'y'.repeat(20), attributes: { bold: true } }],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en.text).toHaveLength(4000);
    expect(result.content.summary.en.marks).toEqual([{ from: 3990, to: 4000, bold: true }]);
    expect(result.notes).toEqual([{ code: 'text_shortened', at: 'summary.en' }]);
  });

  it('leaves out a map slot with no image, and says so only when she had labelled it', () => {
    const maps = [
      { label: 'EO: Eyes Open', name: '', img: null },
      { label: '', name: '', img: null },
      { label: 'Her own view', name: '', img: null },
      { label: 'EC: Eyes Closed', name: 'b.png', img: { url: PNG, w: 10, h: 20 } },
    ];
    const result = readOk(withFile({ maps }));
    expect(result.images.map((i) => [i.key, i.position])).toEqual([['map-3', 0]]);
    expect(result.images[0]?.condition).toBe('eyes_closed');
    expect(result.notes).toEqual([{ code: 'map_without_image_dropped', at: 'images.map-2' }]);
  });

  it('keys each picture by its place in the file, and notes each place left out', () => {
    const map = { label: 'EO: Eyes Open', name: '', img: { url: PNG, w: 1, h: 1 } };
    const unreadable = { label: '', name: '', img: { url: 'https://example.com/a.png' } };
    const maps = [map, unreadable, map, { label: 'Her own view', img: null }, map];
    const result = readOk(withFile({ maps }));
    expect(result.images.map((i) => [i.key, i.position])).toEqual([
      ['map-0', 0],
      ['map-2', 1],
      ['map-4', 2],
    ]);
    expect(result.notes).toEqual([
      { code: 'map_without_image_dropped', at: 'images.map-1' },
      { code: 'map_without_image_dropped', at: 'images.map-3' },
    ]);
    expect(validateQeegContent(result.content)).toMatchObject({ ok: true });
  });

  it('keeps any other label of a map as its caption, and says so', () => {
    const maps = [{ label: 'Eyes open, second run', name: '', img: { url: PNG, w: 1, h: 2 } }];
    const result = readOk(withFile({ maps }));
    expect(result.images).toEqual([
      {
        key: 'map-0',
        position: 0,
        dataUrl: PNG,
        widthPx: 1,
        heightPx: 2,
        condition: null,
        caption: { en: 'Eyes open, second run', ar: null },
      },
    ]);
    expect(result.notes).toEqual([{ code: 'map_label_kept_as_caption', at: 'images.map-0' }]);
  });

  it('reads a map with no label as having no condition and no caption, without a note', () => {
    const maps = [{ label: '', name: '', img: { url: PNG, w: 3, h: 4 } }];
    const result = readOk(withFile({ maps }));
    expect(result.images[0]).toMatchObject({ condition: null, caption: null });
    expect(result.notes).toEqual([]);
  });

  it('reads a size it cannot read as nought', () => {
    const maps = [{ label: 'EO: Eyes Open', name: '', img: { url: PNG, w: 'wide', h: 12.7 } }];
    expect(readOk(withFile({ maps })).images[0]).toMatchObject({ widthPx: 0, heightPx: 12 });
  });

  it('does not carry a picture that is not held in the file itself', () => {
    const maps = [
      { label: 'EO: Eyes Open', name: '', img: { url: 'https://example.com/map.png', w: 1, h: 1 } },
    ];
    const result = readOk(withFile({ maps }));
    expect(result.images).toEqual([]);
    expect(result.notes).toEqual([{ code: 'map_without_image_dropped', at: 'images.map-0' }]);
  });

  it('carries a PNG, JPEG, WebP or BMP picture and nothing else, and says what it dropped', () => {
    for (const type of ['png', 'jpeg', 'webp', 'bmp', 'PNG']) {
      const url = `data:image/${type};base64,AAAA`;
      const maps = [{ label: 'EO: Eyes Open', name: '', img: { url, w: 1, h: 1 } }];
      expect(
        readOk(withFile({ maps })).images.map((i) => i.dataUrl),
        type,
      ).toEqual([url]);
    }
    for (const type of ['svg+xml', 'x-anything', 'gif', 'png+xml']) {
      const url = `data:image/${type};base64,AAAA`;
      const maps = [{ label: 'EO: Eyes Open', name: '', img: { url, w: 1, h: 1 } }];
      const result = readOk(withFile({ maps }));
      expect(result.images, type).toEqual([]);
      expect(result.notes, type).toEqual([
        { code: 'map_without_image_dropped', at: 'images.map-0' },
      ]);
    }
  });

  it('notes twenty places left out, and then one note that more were', () => {
    const maps = Array.from({ length: 25 }, () => ({ label: 'Her own view', img: null }));
    const result = readOk(withFile({ maps }));
    expect(result.notes).toEqual([
      ...Array.from({ length: LIMITS.placesLeftOut }, (_, i) => ({
        code: 'map_without_image_dropped',
        at: `images.map-${i}`,
      })),
      { code: 'extra_positions_ignored', at: 'images' },
    ]);
  });

  it('keeps at most eight pictures, and names the first place not kept', () => {
    const map = { label: 'EO: Eyes Open', name: '', img: { url: PNG, w: 1, h: 1 } };
    const maps = [{ label: '', img: null }, ...Array.from({ length: 10 }, () => map)];
    const result = readOk(withFile({ maps }));
    expect(result.images).toHaveLength(8);
    expect(result.images.map((i) => i.position)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.images.at(-1)?.key).toBe('map-8');
    expect(result.notes).toEqual([{ code: 'extra_positions_ignored', at: 'images.map-9' }]);
  });

  it('does not carry a signature image, and says so', () => {
    const signed = 'data:image/png;base64,U0lHTkVE';
    const result = readOk(withFile({ signature: { url: signed, name: 'sig.png' } }));
    expect(JSON.stringify(result)).not.toContain('U0lHTkVE');
    expect(result.notes).toEqual([{ code: 'signature_image_dropped', at: 'provenance.asPrinted' }]);
  });

  it('reads a date that is not a real day as unset, and says so', () => {
    for (const date of [
      '2026-02-30',
      '14/03/2026',
      '2026-3-14',
      '2026-13-01',
      'soon',
      '0050-06-01',
      '0000-01-01',
      '9999-12-31',
    ]) {
      const result = readOk(withSubject({ date }));
      expect(result.content.recording.recordedOn).toBeNull();
      expect(result.notes).toEqual([{ code: 'value_not_recognised', at: 'recording.recordedOn' }]);
    }
    expect(content(withSubject({ date: '2024-02-29' })).recording.recordedOn).toBe('2024-02-29');
  });

  it('reads a date left blank as unset, without a note', () => {
    const result = readOk(withSubject({ date: '' }));
    expect(result.content.recording.recordedOn).toBeNull();
    expect(result.notes).toEqual([]);
  });

  it('reads an empty signer as not named', () => {
    const c = content(withFile({ signer: '', role: undefined }));
    expect(c.provenance).toMatchObject({ asPrinted: { signerName: null, signerRole: null } });
  });

  it('reads a file with no version as version 1, as the old tool did', () => {
    const file = fullFile();
    delete file['v'];
    expect(readLegacyReport(file, SHA).ok).toBe(true);
  });
});

describe('typed text is made fit to store', () => {
  const HOSTILE = 'a\u0000b\u202Ec';

  it('trims a label of white space and a letter to the letter, without a note', () => {
    const customKF = [{ text: `${' '.repeat(160)}x`, checked: true }];
    const result = readOk(withFile({ customKF }));
    expect(result.content.findings.custom['c0']?.label).toEqual({ en: 'x', ar: null });
    expect(result.notes).toEqual([]);
    expect(validateQeegContent(result.content)).toMatchObject({ ok: true });
  });

  it('removes a control character from a label, and says the label was shortened', () => {
    const customKF = [{ text: HOSTILE, textAr: HOSTILE, checked: true }];
    const result = readOk(withFile({ customKF }));
    expect(result.content.findings.custom['c0']?.label).toEqual({ en: 'abc', ar: 'abc' });
    expect(result.notes).toEqual([
      { code: 'text_shortened', at: 'findings.custom.c0.label.en' },
      { code: 'text_shortened', at: 'findings.custom.c0.label.ar' },
    ]);
    expect(validateQeegContent(result.content)).toMatchObject({ ok: true });
  });

  it('removes a control character from a plain summary, and says so', () => {
    const result = readOk(withFile({ summary: HOSTILE, summaryRich: undefined }));
    expect(result.content.summary.en).toEqual({ text: 'abc', marks: [] });
    expect(result.notes).toEqual([{ code: 'text_shortened', at: 'summary.en' }]);
  });

  it('removes a control character from a formatted summary before its marks are counted', () => {
    const summaryRich = JSON.stringify({
      ops: [
        { insert: 'a\u0000b\u202E ' },
        { insert: 'bold', attributes: { bold: true } },
        { insert: '\n' },
      ],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({
      text: 'ab bold',
      marks: [{ from: 3, to: 7, bold: true }],
    });
    expect(result.notes).toEqual([{ code: 'text_shortened', at: 'summary.en' }]);
  });

  it('composes two letters across the edge of a mark without moving the next mark', () => {
    // The re-check's input: two Korean jamo that compose into one letter, bold
    // over the first only, the second no combining mark.
    const summaryRich = JSON.stringify({
      ops: [
        { insert: '\u1100', attributes: { bold: true } },
        { insert: '\u1161 ' },
        { insert: 'word', attributes: { underline: true } },
        { insert: '\n' },
      ],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({
      text: '\uac00 word',
      marks: [
        { from: 0, to: 1, bold: true },
        { from: 2, to: 6, underline: true },
      ],
    });
    expect(result.notes).toEqual([]);
    expect(validateQeegContent(result.content)).toMatchObject({ ok: true });
  });

  it('trims a formatted summary at its start and keeps its marks on their letters', () => {
    const summaryRich = JSON.stringify({
      ops: [{ insert: '  lead ' }, { insert: 'x', attributes: { bold: true } }, { insert: '\n' }],
    });
    const result = readOk(withFile({ summaryRich }));
    expect(result.content.summary.en).toEqual({
      text: 'lead x',
      marks: [{ from: 5, to: 6, bold: true }],
    });
    expect(result.notes).toEqual([]);
  });

  it('reads typed text that draws nothing as nothing, and its output meets the shape', () => {
    for (const character of DRAWS_NOTHING) {
      const code = character.codePointAt(0)?.toString(16);
      const result = readOk(
        withFile({
          customKF: [
            { text: character, checked: true },
            { text: 'Kept', textAr: character, checked: true },
          ],
          dims: [{ score: '5', evid: 'Seen', evidAr: character }],
          summaryAr: character,
          summaryRichAr: JSON.stringify({ ops: [{ insert: `${character}\n` }] }),
          signer: character,
        }),
      );
      expect(Object.keys(result.content.findings.custom), code).toEqual(['c0']);
      expect(result.content.findings.custom['c0']?.label, code).toEqual({ en: 'Kept', ar: null });
      expect(result.content.dashboard.mental_energy.evidence, code).toEqual({
        en: 'Seen',
        ar: null,
      });
      expect(result.content.summary.ar, code).toBeNull();
      expect(result.content.provenance, code).toMatchObject({ asPrinted: { signerName: null } });
      expect(validateQeegContent(result.content), code).toEqual({
        ok: true,
        content: result.content,
      });
    }
  });

  it('trims what was padded, without a note', () => {
    const result = readOk(
      withFile({
        customBN: [{ text: '  padded  ', note: '  padded  ', checked: true }],
        dims: [{ score: '5', evid: '  padded  ', evidAr: '  padded  ' }],
        signer: '  padded  ',
      }),
    );
    expect(result.content.benefits.custom['c0']?.label).toEqual({ en: 'padded', ar: null });
    expect(result.content.dashboard.mental_energy.evidence).toEqual({
      en: 'padded',
      ar: 'padded',
    });
    expect(result.content.provenance).toMatchObject({ asPrinted: { signerName: 'padded' } });
    expect(result.notes.filter((note) => note.code === 'text_shortened')).toEqual([]);
  });

  it('cleans what the file typed about the person', () => {
    const result = readOk(withSubject({ name: `  ${HOSTILE} `, age: ' 34 ', gender: 'Female' }));
    expect(result.asTyped).toMatchObject({ name: 'abc', age: '34', sex: 'Female' });
    expect(result.notes).toEqual([{ code: 'text_shortened', at: 'asTyped.name' }]);
  });
});

describe('where a note points', () => {
  it('points at a place that exists in what the reader hands back', () => {
    const caption = 'x'.repeat(200);
    const result = readOk(
      withFile({
        maps: [{ label: caption, name: '', img: { url: PNG, w: 1, h: 1 } }],
        signature: { url: PNG, name: 'sig.png' },
      }),
    );
    expect(result.notes).toEqual([
      { code: 'map_label_kept_as_caption', at: 'images.map-0' },
      { code: 'text_shortened', at: 'images.map-0.caption.en' },
      { code: 'signature_image_dropped', at: 'provenance.asPrinted' },
    ]);
    expect(result.images[0]?.key).toBe('map-0');
  });
});

describe('what the reader refuses', () => {
  it('refuses what is not an object', () => {
    for (const file of [null, undefined, 42, 'report', true, [], [fullFile()]]) {
      expect(readLegacyReport(file, SHA)).toEqual({ ok: false, reason: 'not_an_object' });
    }
  });

  it('refuses an object with no person in it', () => {
    const file = fullFile();
    delete file[LEGACY_SUBJECT_KEY];
    expect(readLegacyReport(file, SHA)).toEqual({ ok: false, reason: 'not_a_report_file' });
    expect(readLegacyReport({}, SHA)).toEqual({ ok: false, reason: 'not_a_report_file' });
    expect(readLegacyReport({ [LEGACY_SUBJECT_KEY]: 'x' }, SHA)).toEqual({
      ok: false,
      reason: 'not_a_report_file',
    });
  });

  it('refuses a version it does not know', () => {
    for (const v of [2, 0, '1', null]) {
      expect(readLegacyReport(withFile({ v }), SHA)).toEqual({
        ok: false,
        reason: 'unknown_version',
      });
    }
  });
});

describe('whatever it is given', () => {
  it('never throws', () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 10_000; i += 1) {
      const next = {};
      deep['kf'] = next;
      deep[LEGACY_SUBJECT_KEY] = next;
      deep = next;
    }
    const throwing = Object.defineProperty({}, LEGACY_SUBJECT_KEY, {
      enumerable: true,
      get() {
        throw new Error('no');
      },
    });
    const throwingInside = {
      [LEGACY_SUBJECT_KEY]: Object.defineProperty({}, 'name', {
        enumerable: true,
        get() {
          throw new Error('no');
        },
      }),
    };
    const throwingList = withFile({
      kf: new Proxy([], {
        get() {
          throw new Error('no');
        },
      }),
    });
    for (const file of [
      null,
      42,
      'report',
      [],
      root,
      throwing,
      throwingInside,
      throwingList,
      withFile({ bands: 'x', links: [], dims: {}, maps: {}, customKF: 7, summaryRich: 3 }),
    ]) {
      expect(() => readLegacyReport(file, SHA)).not.toThrow();
    }
    expect(readLegacyReport(throwing, SHA).ok).toBe(false);
  });

  it('gives equal results for the same file twice', () => {
    expect(readLegacyReport(fullFile(), SHA)).toEqual(readLegacyReport(fullFile(), SHA));
    const file = withFile({ kf: ticks(12, [11]), sessions: 'many' });
    expect(readLegacyReport(file, SHA)).toEqual(readLegacyReport(file, SHA));
  });

  it('does not change what it is given', () => {
    const file = deepFreeze(
      withFile({
        kf: ticks(12, [0, 11]),
        signature: { url: PNG, name: 'sig.png' },
        customKF: Array.from({ length: 13 }, () => ({ text: 'z'.repeat(170), checked: true })),
      }),
    );
    const before = JSON.stringify(file);
    expect(() => readLegacyReport(file, SHA)).not.toThrow();
    expect(JSON.stringify(file)).toBe(before);
  });
});
