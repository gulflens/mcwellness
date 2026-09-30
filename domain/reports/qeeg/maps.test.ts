import { describe, expect, it } from 'vitest';
import { blankFollowUp, blankInitial } from './blank';
import {
  addMap,
  choosePair,
  labelMap,
  putBack,
  compareWith,
  mapRefusal,
  mapsInOrder,
  moveMap,
  placeMap,
  removeMap,
  whereStillNamed,
} from './maps';
import { validateQeegContent } from './shape';
import { LIMITS, type ComparedWith, type FigureRef, type QeegContent } from './types';

/**
 * The brain maps a draft names, changed as the form changes them: added at
 * the end, placed, moved, taken out, and paired on a follow-up. Every answer
 * is a new content the shape accepts, and the one given is never changed.
 */

const COMPARED: ComparedWith = {
  reportId: '00000006-0000-4000-8000-000000000001',
  recordedOn: '2026-06-01',
  relation: 'initial',
  origin: 'issued',
  reference: 'RPT-000001',
};

function figure(n: number): FigureRef {
  return {
    figureId: `0000000d-0000-4000-8000-00000000000${n}`,
    sha256: String(n).repeat(64),
    widthPx: 800 + n,
    heightPx: 600,
  };
}

function valid(content: QeegContent): QeegContent {
  const checked = validateQeegContent(content);
  if (!checked.ok) throw new Error(JSON.stringify(checked.refusals));
  return checked.content;
}

describe('adding a brain map', () => {
  it('puts it at the end with its condition, under a key the app makes', () => {
    const one = addMap(blankInitial(), figure(1), 'eyes_closed');
    const two = addMap(one, figure(2), null);
    const listed = mapsInOrder(valid(two));
    expect(listed.map((each) => each.entry.figureId)).toEqual([
      figure(1).figureId,
      figure(2).figureId,
    ]);
    expect(listed.map((each) => each.entry.position)).toEqual([0, 1]);
    expect(listed[0]?.entry.condition).toBe('eyes_closed');
    expect(listed[1]?.entry).toMatchObject({ condition: null, caption: null });
    for (const { key } of listed) expect(key).toMatch(/^[a-z][a-z0-9-]{0,31}$/);
  });

  it('does not add the same picture twice', () => {
    const one = addMap(blankInitial(), figure(1), 'eyes_open');
    expect(addMap(one, figure(1), 'eyes_closed')).toBe(one);
  });

  it('refuses a ninth, and says so before anything is sent', () => {
    let content: QeegContent = blankInitial();
    for (let n = 0; n < LIMITS.maps; n += 1) {
      expect(mapRefusal(content)).toBeNull();
      content = addMap(content, figure(n), null);
    }
    expect(mapRefusal(content)).toBe('too_many_maps');
    expect(addMap(content, figure(9), null)).toBe(content);
  });

  it('leaves the content it was given as it was', () => {
    const blank = blankInitial();
    addMap(blank, figure(1), null);
    expect(blank.maps).toEqual({});
  });
});

describe('placing and moving a map', () => {
  const three = [1, 2, 3].reduce<QeegContent>(
    (content, n) => addMap(content, figure(n), null),
    blankInitial(),
  );

  it('sets its condition, and its own label only where it has no condition', () => {
    const placed = placeMap(three, figure(2).figureId, 'eyes_open', null);
    expect(mapsInOrder(placed)[1]?.entry.condition).toBe('eyes_open');
    const named = placeMap(three, figure(2).figureId, null, { en: 'Coherence', ar: null });
    expect(mapsInOrder(valid(named))[1]?.entry.caption).toEqual({ en: 'Coherence', ar: null });
    const both = placeMap(named, figure(2).figureId, 'eyes_closed', { en: 'Coherence', ar: null });
    expect(mapsInOrder(both)[1]?.entry.caption).toBeNull();
  });

  it('moves one place up or down, and not past either end', () => {
    const up = moveMap(three, figure(3).figureId, -1);
    expect(mapsInOrder(valid(up)).map((each) => each.entry.figureId)).toEqual([
      figure(1).figureId,
      figure(3).figureId,
      figure(2).figureId,
    ]);
    expect(moveMap(three, figure(1).figureId, -1)).toBe(three);
    expect(moveMap(three, figure(3).figureId, 1)).toBe(three);
  });
});

describe('taking a map out', () => {
  it('closes the gap it leaves', () => {
    const three = [1, 2, 3].reduce<QeegContent>(
      (content, n) => addMap(content, figure(n), null),
      blankInitial(),
    );
    const out = valid(removeMap(three, figure(1).figureId));
    expect(mapsInOrder(out).map((each) => [each.entry.figureId, each.entry.position])).toEqual([
      [figure(2).figureId, 0],
      [figure(3).figureId, 1],
    ]);
  });

  it('says where else the report still names it', () => {
    const own = addMap(blankFollowUp(COMPARED, 'follow_up'), figure(2), 'eyes_open');
    const paired = choosePair(own, 'eyes_open', 'later', figure(2));
    expect(whereStillNamed(paired, figure(2).figureId)).toEqual(['change.pairs.eyes_open.later']);
    expect(whereStillNamed(own, figure(2).figureId)).toEqual([]);
  });
});

describe('the before-and-after pairs of a follow-up', () => {
  it('names a picture on either side, and none again', () => {
    const start = blankFollowUp(COMPARED, 'follow_up');
    const earlier = choosePair(start, 'eyes_closed', 'earlier', figure(1));
    const both = choosePair(earlier, 'eyes_closed', 'later', figure(2));
    const content = valid(both);
    if (content.edition !== 'follow-up') throw new Error('a follow-up');
    expect(content.change.pairs.eyes_closed).toEqual({ earlier: figure(1), later: figure(2) });
    expect(content.change.pairs.eyes_open).toEqual({ earlier: null, later: null });
    const cleared = choosePair(both, 'eyes_closed', 'earlier', null);
    if (cleared.edition !== 'follow-up') throw new Error('a follow-up');
    expect(cleared.change.pairs.eyes_closed.earlier).toBeNull();
  });

  it('keeps only the four fields of a reference', () => {
    const extra = { ...figure(1), condition: 'eyes_open', caption: null } as unknown as FigureRef;
    const content = choosePair(blankFollowUp(COMPARED, 'follow_up'), 'eyes_open', 'later', extra);
    if (content.edition !== 'follow-up') throw new Error('a follow-up');
    expect(content.change.pairs.eyes_open.later).toEqual(figure(1));
  });

  it('are not a first report’s', () => {
    const blank = blankInitial();
    expect(choosePair(blank, 'eyes_open', 'later', figure(1))).toBe(blank);
  });

  it('let go of the earlier side when another report is compared with', () => {
    const start = choosePair(
      blankFollowUp(COMPARED, 'follow_up'),
      'eyes_open',
      'earlier',
      figure(1),
    );
    const withLater = choosePair(start, 'eyes_open', 'later', figure(2));
    const other = { ...COMPARED, reportId: '00000006-0000-4000-8000-000000000002' };
    const moved = compareWith(withLater, other);
    if (moved.edition !== 'follow-up') throw new Error('a follow-up');
    expect(moved.comparedWith).toEqual(other);
    expect(moved.change.pairs.eyes_open).toEqual({ earlier: null, later: figure(2) });
    // The same report again changes nothing.
    expect(compareWith(withLater, COMPARED)).toBe(withLater);
  });
});

describe('a map put back after a refused removal', () => {
  it('returns to its place, and keeps a map added since', () => {
    const three = [1, 2, 3].reduce<QeegContent>(
      (content, n) => addMap(content, figure(n), null),
      blankInitial(),
    );
    const taken = mapsInOrder(three)[1];
    if (!taken) throw new Error('three maps');
    const without = removeMap(three, figure(2).figureId);
    const added = addMap(without, figure(4), 'eyes_open');
    const back = valid(putBack(added, taken));
    expect(mapsInOrder(back).map((each) => each.entry.figureId)).toEqual([
      figure(1).figureId,
      figure(2).figureId,
      figure(3).figureId,
      figure(4).figureId,
    ]);
    expect(putBack(back, taken)).toBe(back);
  });
});

describe('her own label for a map', () => {
  it('changes the English and keeps the Arabic as it is', () => {
    const start = placeMap(addMap(blankInitial(), figure(1), null), figure(1).figureId, null, {
      en: 'Coherence',
      ar: 'تماسك',
    });
    const typed = labelMap(start, figure(1).figureId, 'Coherence map');
    expect(mapsInOrder(typed)[0]?.entry.caption).toEqual({ en: 'Coherence map', ar: 'تماسك' });
  });

  it('is none once emptied, when there is no Arabic', () => {
    const start = addMap(blankInitial(), figure(1), null);
    expect(mapsInOrder(labelMap(start, figure(1).figureId, ''))[0]?.entry.caption).toBeNull();
    const named = labelMap(start, figure(1).figureId, 'Coherence');
    expect(mapsInOrder(labelMap(named, figure(1).figureId, ' '))[0]?.entry.caption).toBeNull();
  });
});

describe('the eight a report holds, counted as the door counts them', () => {
  it('counts pictures uploaded and not placed as well as the maps placed', () => {
    const six = [0, 1, 2, 3, 4, 5].reduce<QeegContent>(
      (content, n) => addMap(content, figure(n), null),
      blankInitial(),
    );
    expect(mapRefusal(six, 1)).toBeNull();
    expect(mapRefusal(six, 2)).toBe('too_many_maps');
  });
});
