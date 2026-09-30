import { describe, expect, it } from 'vitest';
import { twinChangeIn } from '../../../../domain/reports/qeeg/twin';
import { fullFollowUp, fullReport } from '../../../../domain/reports/qeeg/testing/reports';
import type { QeegContent, QeegInitial } from '../../../../domain/reports/qeeg/types';
import { typedTextsOf } from './typedTexts';

/**
 * The typed texts a second-language draft may give its own language's version
 * of, as its form lists them (brief Q): each printed piece of her own typing,
 * named in English, and a setter that writes that language's half and nothing
 * else.
 */

function withOwnFinding(content: QeegInitial): QeegInitial {
  return {
    ...content,
    findings: {
      ...content.findings,
      custom: {
        c0: { label: { en: 'Restless evenings', ar: null }, note: null, chosen: true, position: 0 },
        c1: { label: { en: 'Set aside', ar: null }, note: null, chosen: false, position: 1 },
      },
    },
  };
}

describe('typedTextsOf', () => {
  it('lists the summary and every printed item of her own, by what it is', () => {
    const texts = typedTextsOf(withOwnFinding(fullReport()), 'ar');
    const names = texts.map((text) => text.of);
    expect(names).toContain('the summary');
    expect(names).toContain('your own key finding “Restless evenings”');
    // An item she set aside is not printed, so it is not asked for.
    expect(names.some((name) => name.includes('Set aside'))).toBe(false);
  });

  it('shows the English each is the version of', () => {
    const texts = typedTextsOf(withOwnFinding(fullReport()), 'ar');
    const own = texts.find((text) => text.of.includes('Restless evenings'));
    expect(own?.english).toBe('Restless evenings');
    expect(own?.value).toBeNull();
  });

  it('writes only the half of its own language, and so passes the twin’s rule', () => {
    const first = withOwnFinding(fullReport());
    let content: QeegContent = first;
    for (const text of typedTextsOf(first, 'ar')) content = text.set(content, 'نص عربي');
    expect(twinChangeIn(first, content, 'ar')).toBeNull();
    expect(content.summary.ar?.text).toBe('نص عربي');
    expect(content.findings.custom['c0']?.label).toEqual({
      en: 'Restless evenings',
      ar: 'نص عربي',
    });
    expect(content.summary.en).toEqual(first.summary.en);
  });

  it('clears a half emptied, to none', () => {
    const first = fullReport();
    const summary = typedTextsOf(first, 'ar').find((text) => text.of === 'the summary');
    const given = summary?.set(first, 'ملخص') ?? first;
    const cleared = summary?.set(given, null) ?? given;
    expect(cleared.summary.ar).toBeNull();
  });

  it('lists a follow-up’s headlines and its page of what has changed', () => {
    const names = typedTextsOf(fullFollowUp(), 'ar').map((text) => text.of);
    expect(names).toContain('what has changed');
    expect(names.some((name) => name.startsWith('the headline'))).toBe(true);
  });

  it('writes the English half on an English report made from an Arabic one', () => {
    const first = fullReport();
    const summary = typedTextsOf(first, 'en').find((text) => text.of === 'the summary');
    const written = summary?.set(first, 'Said again.') ?? first;
    expect(written.summary.en.text).toBe('Said again.');
    expect(twinChangeIn(first, written, 'en')).toBeNull();
  });
});

describe('typedTextsOf, formatted text (fix round 1)', () => {
  it('offers the summaries as formatted text, whose marks reach the half of its language', () => {
    const first = fullReport();
    const summary = typedTextsOf(first, 'ar').find((text) => text.of === 'the summary');
    expect(summary?.rich).toBeTruthy();
    const marked = { text: 'ملخص هادئ', marks: [{ from: 0, to: 4, bold: true as const }] };
    const written = summary?.rich?.set(first, marked) ?? first;
    expect(written.summary.ar).toEqual(marked);
    expect(written.summary.en).toEqual(first.summary.en);
    expect(twinChangeIn(first, written, 'ar')).toBeNull();
    expect(summary?.rich?.set(written, null).summary.ar).toBeNull();
  });
});
