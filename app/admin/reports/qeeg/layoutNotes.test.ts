import { describe, expect, it } from 'vitest';
import { blankInitial } from '../../../../domain/reports/qeeg/blank';
import type { QeegInitial } from '../../../../domain/reports/qeeg/types';
import type { QeegLayoutNotes } from '../../../api/reports/schema';
import { layoutLines } from './layoutNotes';

const A = '0000000d-0000-4000-8000-000000000001';
const B = '0000000d-0000-4000-8000-000000000002';

const content: QeegInitial = {
  ...blankInitial(),
  maps: {
    'map-a': {
      figureId: A,
      sha256: 'a'.repeat(64),
      widthPx: 800,
      heightPx: 600,
      condition: 'eyes_closed',
      caption: null,
      position: 0,
    },
    'map-b': {
      figureId: B,
      sha256: 'b'.repeat(64),
      widthPx: 800,
      heightPx: 600,
      condition: null,
      caption: { en: 'Coherence', ar: null },
      position: 1,
    },
  },
};

function notes(over: Partial<QeegLayoutNotes> = {}): QeegLayoutNotes {
  return {
    pages: 7,
    dashboardScale: 1,
    overflowing: [],
    unprintable: [],
    unprintableMore: 0,
    maps: [],
    pairs: [],
    ...over,
  };
}

describe('what the form says of the pages beside the Preview button', () => {
  it('says how many pages there are, and that the dashboard fits whole', () => {
    expect(layoutLines(notes(), content)).toEqual([
      '7 pages.',
      'The dashboard fits its page at full size.',
    ]);
    expect(layoutLines(notes({ pages: 1 }), content)[0]).toBe('1 page.');
  });

  it('says the scale the dashboard was drawn at when it was made smaller', () => {
    expect(layoutLines(notes({ dashboardScale: 0.908 }), content)).toContain(
      'The dashboard is drawn at 91% of its size to fit its page.',
    );
  });

  it('names what runs over by the heading it prints under, never by a part id', () => {
    const lines = layoutLines(
      notes({ overflowing: ['summary.1', 'summary.2', 'benefits.list'] }),
      content,
    );
    expect(lines).toContain('Runs past the foot of its page: Summary, Potential Benefits.');
    expect(lines.join(' ')).not.toMatch(/summary\.1|benefits\.list/);
  });

  it('names each character the typeface cannot draw, by its code point', () => {
    expect(layoutLines(notes({ unprintable: ['U+0141', 'U+FEFB'] }), content)).toContain(
      'The typeface cannot draw Ł (U+0141), U+FEFB. Those characters would be left out of the page.',
    );
  });

  it('counts the characters beyond those named', () => {
    expect(layoutLines(notes({ unprintable: ['U+0141'], unprintableMore: 12 }), content)).toContain(
      'The typeface cannot draw Ł (U+0141) and 12 more. Those characters would be left out of the page.',
    );
  });

  it('says how each map will print, in the words of section 9, point 4', () => {
    const lines = layoutLines(
      notes({
        maps: [
          { figureId: A, dpi: 300, quality: 'good' },
          { figureId: B, dpi: 180, quality: 'fair' },
        ],
      }),
      content,
    );
    expect(lines).toContain('Map 1, eyes closed, will print sharply (about 300 dots to the inch).');
    expect(lines).toContain(
      'Map 2, Coherence, will print a little soft (about 180 dots to the inch).',
    );
    const poor = layoutLines(
      notes({ maps: [{ figureId: A, dpi: 120, quality: 'poor' }] }),
      content,
    );
    expect(poor).toContain(
      'Map 1, eyes closed, will look pixelated and is worth exporting again (about 120 dots to the inch).',
    );
  });

  it('says how each map of a before-and-after pair will print', () => {
    const lines = layoutLines(
      notes({
        pairs: [
          { figureId: A, condition: 'eyes_open', side: 'earlier', dpi: 480, quality: 'good' },
        ],
      }),
      content,
    );
    expect(lines).toContain(
      'What has changed, eyes open, the earlier map, will print sharply (about 480 dots to the inch).',
    );
  });
});
