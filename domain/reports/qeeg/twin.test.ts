import { describe, expect, it } from 'vitest';
import { firstDifference, twinChangeIn } from './twin';
import { fullFollowUp, fullReport } from './testing/reports';
import type { QeegContent, QeegFollowUp, QeegInitial } from './types';

/**
 * Brief Q: a save of the second-language report may change only the halves
 * of typed text in its own language. Anything else it tries to change is
 * refused by the field, never dropped in silence.
 */

function withArabicSummary(content: QeegInitial, text: string): QeegInitial {
  return { ...content, summary: { ...content.summary, ar: { text, marks: [] } } };
}

describe('firstDifference', () => {
  it('finds nothing between two equal values, whatever the order of their keys', () => {
    expect(firstDifference({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBeNull();
  });

  it('names the path of the first value that differs', () => {
    expect(firstDifference({ a: { b: 1 } }, { a: { b: 2 } })).toBe('a.b');
    expect(firstDifference({ a: [1, 2] }, { a: [1, 3] })).toBe('a.1');
  });

  it('names a key one side holds and the other does not', () => {
    expect(firstDifference({ a: 1 }, { a: 1, z: 2 })).toBe('z');
    expect(firstDifference({ a: 1, y: 2 }, { a: 1 })).toBe('y');
  });

  it('names a list that grew or shrank by the list', () => {
    expect(firstDifference({ a: [1] }, { a: [1, 2] })).toBe('a');
  });

  it('tells null from an empty object and a number from its text', () => {
    expect(firstDifference({ a: null }, { a: {} })).toBe('a');
    expect(firstDifference({ a: 1 }, { a: '1' })).toBe('a');
  });
});

describe('twinChangeIn', () => {
  const first = fullReport();

  it('takes a save that changes only the Arabic halves', () => {
    const sent = withArabicSummary(first, 'ملخص قصير');
    expect(twinChangeIn(first, sent, 'ar')).toBeNull();
  });

  it('takes a save that changes nothing at all', () => {
    expect(twinChangeIn(first, structuredClone(first), 'ar')).toBeNull();
  });

  it('refuses a changed score by its field', () => {
    const sent: QeegContent = {
      ...first,
      dashboard: {
        ...first.dashboard,
        attention_focus: {
          ...first.dashboard.attention_focus,
          score: first.dashboard.attention_focus.score === 3 ? 4 : 3,
        },
      },
    };
    expect(twinChangeIn(first, sent, 'ar')).toBe('dashboard.attention_focus.score');
  });

  it('refuses a finding ticked or unticked', () => {
    const sent: QeegContent = { ...first, findings: { ...first.findings, chosen: [] } };
    expect(twinChangeIn(first, sent, 'ar')).toMatch(/^findings\.chosen/);
  });

  it('refuses an English half changed on an Arabic report', () => {
    const sent: QeegContent = {
      ...first,
      summary: { ...first.summary, en: { text: 'Another summary.', marks: [] } },
    };
    expect(twinChangeIn(first, sent, 'ar')).toMatch(/^summary\.en/);
  });

  it('refuses a map moved, and the edition changed', () => {
    const maps = Object.fromEntries(
      Object.entries(first.maps).map(([key, map]) => [key, { ...map, position: map.position + 1 }]),
    );
    expect(twinChangeIn(first, { ...first, maps }, 'ar')).toMatch(/^maps\./);
    expect(twinChangeIn(first, fullFollowUp(), 'ar')).not.toBeNull();
  });

  it('refuses an item of her own that the first report does not hold', () => {
    const sent: QeegContent = {
      ...first,
      findings: {
        ...first.findings,
        custom: {
          ...first.findings.custom,
          zz: { label: { en: 'New', ar: 'جديد' }, note: null, chosen: true, position: 9 },
        },
      },
    };
    expect(twinChangeIn(first, sent, 'ar')).toBe('findings.custom.zz');
  });

  it('takes the English halves on an English report made from an Arabic one', () => {
    const sent: QeegContent = {
      ...first,
      summary: { ...first.summary, en: { text: 'Said again in English.', marks: [] } },
    };
    expect(twinChangeIn(first, sent, 'en')).toBeNull();
    expect(twinChangeIn(first, withArabicSummary(first, 'ملخص'), 'en')).toMatch(/^summary\.ar/);
  });

  it('refuses a follow-up whose change page differs outside its typed halves', () => {
    const follow = fullFollowUp();
    const sent: QeegFollowUp = {
      ...follow,
      change: { ...follow.change, table: {} },
    };
    expect(twinChangeIn(follow, sent, 'ar')).toMatch(/^change\.table/);
  });

  it('changes neither of the reports it is given', () => {
    const one = fullReport();
    const two = withArabicSummary(fullReport(), 'نص');
    const before = [structuredClone(one), structuredClone(two)];
    twinChangeIn(one, two, 'ar');
    expect([one, two]).toEqual(before);
  });
});
