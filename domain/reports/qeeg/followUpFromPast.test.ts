import { describe, expect, it } from 'vitest';
import { DIMENSION_IDS } from './catalogue/ids';
import { LEGACY_SUBJECT_KEY } from './legacy/keys';
import { readLegacyReport } from './legacy/read';
import { prefillFollowUp } from './prefill';
import { validateQeegContent } from './shape';
import { toFollowUp } from './switchEdition';

/**
 * Brief G, item 7: a past record read from the old tool's file, and a
 * follow-up begun from it. The reader and the prefill were built apart; this
 * holds them together. The file is built here, in the old tool's version 1
 * format, with invented content; the names come from `db/seed/names.ts`.
 */

const ID = (n: number) => `0000000C-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SHA = 'e'.repeat(64);
const CLIENT = ID(100);
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function ticks(length: number, at: readonly number[] = []): boolean[] {
  return Array.from({ length }, (_, i) => at.includes(i));
}

/** An old file whose fourth score was never written: the old tool printed 5 for it. */
function oldFile(): Record<string, unknown> {
  return {
    v: 1,
    [LEGACY_SUBJECT_KEY]: {
      name: 'Willow Harbour',
      nameAr: 'صفصاف مرفأ',
      age: '41',
      gender: 'Female',
      hand: 'Left',
      eyes: 'Closed and Open',
      date: '2026-02-10',
      assess: 'Initial QEEG',
    },
    kf: ticks(10, [1, 4]),
    fa: ticks(11, [2]),
    customKF: [{ text: 'Restless evenings', checked: true }],
    maps: [
      { label: 'EO: Eyes Open', name: 'open.png', img: { url: PNG, w: 800, h: 600 } },
      { label: 'EC: Eyes Closed', name: 'closed.png', img: { url: PNG, w: 800, h: 600 } },
    ],
    bands: [
      { lvl: 'Increased', regions: ticks(9, [0]) },
      { lvl: 'Reduced', regions: ticks(9, [2]) },
      { lvl: 'Within normal limits', regions: ticks(9) },
      { lvl: 'Increased', regions: ticks(9, [1]) },
      { lvl: 'Reduced', regions: ticks(9, [3]) },
    ],
    links: {
      conn: { lvl: 'mixed', regions: ticks(9, [0]) },
      asym: { lvl: 'left', regions: ticks(9, [4]) },
      phase: { lvl: 'altered', regions: ticks(9, [8]) },
    },
    dims: [
      { score: '3', evid: 'Tired by noon.' },
      { score: '6', evid: '' },
      { score: '7', evid: '' },
      { evid: '' },
      { score: '2', evid: '' },
      { score: '8', evid: '' },
    ],
    rc: ticks(6, [2]),
    summary: 'A steady start.',
    bn: ticks(9, [1]),
    sessions: '20 Sessions',
    approach: '0',
    signer: 'Hazel Meadow',
    role: 'Practitioner',
    signature: null,
  };
}

function pastRecord() {
  const read = readLegacyReport(oldFile(), SHA);
  if (!read.ok) throw new Error(`expected the file to be read, was refused: ${read.reason}`);
  return read;
}

describe('a follow-up begun from a past record of the old tool', () => {
  const read = pastRecord();
  const answer = prefillFollowUp(
    {
      reportId: ID(1),
      clientId: CLIENT,
      status: 'imported',
      withdrawn: false,
      erased: false,
      reference: null,
      content: read.content,
    },
    { clientId: CLIENT, draftId: null, stage: 'follow_up', recordedOn: '2026-09-15' },
  );

  it('is begun, and passes the shape', () => {
    expect(answer.ok).toBe(true);
    if (!answer.ok) return;
    const shaped = validateQeegContent(answer.content);
    if (!shaped.ok) expect(shaped.refusals).toEqual([]);
    expect(shaped.ok).toBe(true);
  });

  it('says it is compared with an imported record, which has no reference', () => {
    if (!answer.ok) throw new Error('expected a prefill');
    expect(answer.content.comparedWith).toEqual({
      reportId: ID(1),
      recordedOn: '2026-02-10',
      relation: 'initial',
      origin: 'imported',
      reference: null,
    });
    expect(answer.content.provenance).toEqual({ origin: 'app' });
  });

  it('brings forward the six scores the old file held, the one it defaulted to 5 included', () => {
    if (!answer.ok) throw new Error('expected a prefill');
    expect(read.notes).toContainEqual({
      code: 'score_defaulted',
      at: 'dashboard.stress_regulation',
    });
    const { dashboard } = answer.content;
    expect(DIMENSION_IDS.map((d) => dashboard[d].earlierScore)).toEqual([3, 6, 7, 5, 2, 8]);
  });

  it('brings forward the handedness and offers the old choices beside the content', () => {
    if (!answer.ok) throw new Error('expected a prefill');
    expect(answer.content.recording.handedness).toBe('left');
    expect(answer.offered.findings.chosen).toEqual(read.content.findings.chosen);
    expect(answer.offered.findings.custom['c0']?.label.en).toBe('Restless evenings');
    expect(answer.content.findings).toEqual({ chosen: [], custom: {} });
  });

  it('still refuses to turn the past record itself into a follow-up', () => {
    const comparedWith = {
      reportId: ID(1),
      recordedOn: '2026-02-10',
      relation: 'initial',
      origin: 'imported',
      reference: null,
    } as const;
    expect(toFollowUp(read.content, comparedWith, 'follow_up')).toEqual({
      ok: false,
      reason: 'past_record',
    });
  });
});
