import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import { ownLinksNotNamed } from './links';
import type { ComparedWith, FigureRef, QeegFollowUp, QeegInitial } from './types';

const A: FigureRef = {
  figureId: '0000000d-0000-4000-8000-000000000001',
  sha256: 'a'.repeat(64),
  widthPx: 800,
  heightPx: 600,
};
const B: FigureRef = { ...A, figureId: '0000000d-0000-4000-8000-000000000002' };
const C: FigureRef = { ...A, figureId: '0000000d-0000-4000-8000-000000000003' };

const compared: ComparedWith = {
  reportId: '0000000d-0000-4000-8000-0000000000aa',
  recordedOn: '2026-03-14',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

function withMap(figure: FigureRef): QeegInitial {
  return {
    ...blankInitial(),
    maps: { 'map-0': { ...figure, condition: 'eyes_open', caption: null, position: 0 } },
  };
}

describe('ownLinksNotNamed', () => {
  it('finds nothing when every picture uploaded to the draft is placed on it', () => {
    expect(ownLinksNotNamed(withMap(A), [{ figureId: A.figureId, borrowed: false }])).toEqual([]);
  });

  it('names each picture uploaded and never placed, in order of its id', () => {
    const links = [
      { figureId: C.figureId, borrowed: false },
      { figureId: A.figureId, borrowed: false },
      { figureId: B.figureId, borrowed: false },
    ];
    expect(ownLinksNotNamed(withMap(A), links)).toEqual([B.figureId, C.figureId]);
  });

  it('leaves out a borrowed picture: it is the earlier report’s, and she cannot remove it here', () => {
    expect(ownLinksNotNamed(blankInitial(), [{ figureId: A.figureId, borrowed: true }])).toEqual(
      [],
    );
  });

  it('counts a follow-up’s later picture of a pair as placed', () => {
    const blank = blankFollowUp(compared, 'follow_up');
    const content: QeegFollowUp = {
      ...blank,
      change: {
        ...blank.change,
        pairs: { ...blank.change.pairs, eyes_open: { earlier: null, later: B } },
      },
    };
    expect(ownLinksNotNamed(content, [{ figureId: B.figureId, borrowed: false }])).toEqual([]);
  });
});
