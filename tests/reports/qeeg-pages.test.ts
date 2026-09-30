import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { reportFonts } from '../../app/api/billing/fonts';
import {
  COMPARISON_SENTENCE,
  STANDING_SENTENCES,
  WORDS,
} from '../../domain/reports/document/strings';
import { extentOf } from '../../domain/reports/qeeg/document/block';
import { BODY_WIDTH, bodyTop, PAD } from '../../domain/reports/qeeg/document/geometry';
import {
  drawingFor,
  layoutQeegReport,
  renderQeegReport,
} from '../../domain/reports/qeeg/document/index';
import type { Laid, QeegReportInput } from '../../domain/reports/qeeg/document/index';
import type { LayoutOp } from '../../domain/reports/qeeg/document/scale';
import { validateQeegContent } from '../../domain/reports/qeeg/shape';
import {
  CASES,
  factsFor,
  fullFollowUp,
  fullReport,
  MAP_PIXELS,
} from '../../domain/reports/qeeg/testing/reports';
import type { CaseName } from '../../domain/reports/qeeg/testing/reports';
import { speaksOfAnotherPractice } from '../../domain/reports/qeeg/testing/vocabulary';
import type {
  Locale,
  QeegContent,
  QeegFollowUp,
  QeegInitial,
} from '../../domain/reports/qeeg/types';
import { phrase } from '../../domain/reports/qeeg/wording';
import { PAGE_WIDTH } from '../../domain/shared/document';
import type { DocumentImage } from '../../domain/shared/document';

/**
 * docs/SPEC/reports-qeeg.md section 12 and section 19, points 6 to 9, and
 * plan note N10: a first report set in the faces it is printed in, the
 * system's own and a bold Arabic one (`reportFonts`), in both languages.
 * What a reader sees is asked of the installed faces here; the same rules
 * with a measure that makes every number exact are in
 * `domain/reports/qeeg/document/place.test.ts`.
 */

const LOCALES: readonly Locale[] = ['en', 'ar'];
const CASE_NAMES = Object.keys(CASES) as CaseName[];
const SLACK = 0.01;
const fonts = reportFonts();

/**
 * An invented map: bands of colour across a white ground, deflated as a
 * PNG's own lines are, each behind the byte that says it is not filtered.
 * No real map is ever drawn in a test.
 */
function syntheticMap(width: number, height: number): DocumentImage {
  const row = 1 + width * 3;
  const lines = new Uint8Array(row * height);
  for (let y = 0; y < height; y += 1) {
    lines[y * row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = y * row + 1 + x * 3;
      const ring = Math.floor(Math.hypot(x - width / 2, y - height / 2) / 40) % 5;
      lines[at] = 255 - ring * 30;
      lines[at + 1] = 255 - ring * 12;
      lines[at + 2] = 255;
    }
  }
  return { width, height, colours: 'rgb', data: deflateSync(lines) };
}

const MAP = syntheticMap(MAP_PIXELS.width, MAP_PIXELS.height);
const LOGO = syntheticMap(52, 26);

function inputOf(content: QeegContent, locale: Locale): QeegReportInput {
  const facts = factsFor(content);
  const pictures = Object.fromEntries(Object.keys(facts.pictures).map((id) => [id, MAP]));
  return { content, locale, facts: { ...facts, logo: LOGO, pictures } };
}

const layouts = new Map<string, Laid>();
function laid(name: CaseName, locale: Locale): Laid {
  const key = `${name} ${locale}`;
  const known = layouts.get(key);
  if (known) return known;
  const made = layoutQeegReport(inputOf(CASES[name](), locale), fonts);
  layouts.set(key, made);
  return made;
}

const measureOf = (locale: Locale) => drawingFor(fonts, locale === 'en' ? 'ltr' : 'rtl').measure;
const textOf = (ops: readonly LayoutOp[]) =>
  ops.flatMap((op) => (op.kind === 'text' ? [op.text] : [])).join(' ');

describe('the fixtures of these tests', () => {
  it('are reports the shape accepts', () => {
    for (const name of CASE_NAMES) expect(validateQeegContent(CASES[name]()).ok, name).toBe(true);
  });
});

describe('a report on paper, a first report or a follow-up', () => {
  it('runs nothing over the foot of any page, in either language', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        expect(laid(name, locale).overflowing, `${name} ${locale}`).toEqual([]);
      }
    }
  });

  it('overlaps nothing, on any page, in either language', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const measure = measureOf(locale);
        laid(name, locale).sheets.forEach((sheet, page) => {
          const spans = sheet.parts
            .filter((part) => part.ops.length > 0)
            .map((part) => ({ id: part.id, reach: extentOf(part.ops, measure), part }));
          spans.forEach((one, index) => {
            const next = spans[index + 1];
            if (!next) return;
            const where = `${name} ${locale} page ${page + 1}: ${one.id} and ${next.id}`;
            expect(next.part.y, where).toBeGreaterThanOrEqual(one.part.y + one.part.height - SLACK);
            expect(next.reach.top, where).toBeLessThanOrEqual(one.reach.bottom + SLACK);
          });
        });
      }
    }
  });

  it('leaves the margins clear, on every page, in either language', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const measure = measureOf(locale);
        const result = laid(name, locale);
        result.sheets.forEach((sheet, page) => {
          const where = `${name} ${locale} page ${page + 1}`;
          const body = sheet.parts.flatMap((part) => part.ops);
          const reach = extentOf(body, measure);
          expect(reach.left, where).toBeGreaterThanOrEqual(PAD.side - SLACK);
          expect(reach.right, where).toBeLessThanOrEqual(PAGE_WIDTH - PAD.side + SLACK);
          expect(reach.top, where).toBeLessThanOrEqual(bodyTop() + SLACK);
          expect(reach.bottom, where).toBeGreaterThanOrEqual(
            PAD.bottom + result.footerHeight - SLACK,
          );
          const foot = extentOf(sheet.footer, measure);
          expect(foot.left, where).toBeGreaterThanOrEqual(PAD.side - SLACK);
          expect(foot.right, where).toBeLessThanOrEqual(PAGE_WIDTH - PAD.side + SLACK);
          expect(foot.bottom, where).toBeGreaterThanOrEqual(PAD.bottom - SLACK);
        });
      }
    }
  });

  it('fits the dashboard at 0.85 of its size or better', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        expect(laid(name, locale).dashboardScale, `${name} ${locale}`).toBeGreaterThanOrEqual(0.85);
      }
    }
  });

  it('pins the signature to the foot of its page, never alone', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const { sheets, bodyHeight } = laid(name, locale);
        const last = sheets[sheets.length - 1]?.parts ?? [];
        const signature = last[last.length - 1];
        expect(signature?.id).toBe('signature');
        expect(last.length).toBeGreaterThan(1);
        expect((signature?.y ?? 0) + (signature?.height ?? 0)).toBeGreaterThan(bodyHeight * 0.75);
      }
    }
  });

  it('draws the maps across the page body, each on a page of its own', () => {
    const { sheets, maps } = laid('long', 'en');
    const mapPages = sheets.filter((sheet) =>
      sheet.parts.some((part) => part.id.startsWith('map.')),
    );
    expect(mapPages).toHaveLength(8);
    for (const sheet of mapPages) expect(sheet.parts).toHaveLength(1);
    for (const map of maps) expect(map.dpi).toBeGreaterThan(0);
    const image = mapPages[0]?.parts[0]?.ops.find((op) => op.kind === 'image');
    expect(image?.kind === 'image' ? image.width : 0).toBeLessThanOrEqual(BODY_WIDTH + SLACK);
  });
});

describe('the words a report prints', () => {
  it('say nothing of another kind of practice, beyond the agreement’s own sentences', () => {
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const found = laid(name, locale).sheets.flatMap((sheet, page) =>
          [
            { id: 'header', ops: sheet.header },
            ...sheet.parts.filter(
              (part) =>
                !part.id.startsWith('final.standing') && !part.id.startsWith('change.comparison'),
            ),
            { id: 'footer', ops: sheet.footer },
          ]
            .filter((part) => speaksOfAnotherPractice(textOf(part.ops)))
            .map((part) => `${name} ${locale} page ${page + 1} ${part.id}`),
        );
        expect(found).toEqual([]);
        // The guard reads what is drawn: the agreement's sentences, which it
        // lets by, are words it would catch anywhere else.
        const standing = laid(name, locale)
          .sheets.flatMap((sheet) => sheet.parts)
          .filter((part) => part.id.startsWith('final.standing'))
          .map((part) => textOf(part.ops))
          .join(' ');
        expect(speaksOfAnotherPractice(standing), `${name} ${locale}`).toBe(true);
        // So is the comparison's own sentence, on a follow-up's page of what has changed.
        const comparison = laid(name, locale)
          .sheets.flatMap((sheet) => sheet.parts)
          .filter((part) => part.id.startsWith('change.comparison'))
          .map((part) => textOf(part.ops))
          .join(' ');
        if (comparison !== '') {
          expect(speaksOfAnotherPractice(comparison), `${name} ${locale}`).toBe(true);
        }
      }
    }
  });

  it('print the comparison’s own sentence beneath a follow-up’s figures, and nothing else there', () => {
    const squeezed = (text: string) => [...text.replace(/\s+/g, '')].sort().join('');
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const comparison = laid(name, locale)
          .sheets.flatMap((sheet) => sheet.parts)
          .filter((part) => part.id.startsWith('change.comparison'));
        const compares = !['sparse', 'full', 'long', 'qeegOnly', 'followUpSparse'].includes(name);
        expect(comparison.length > 0, `${name} ${locale}`).toBe(compares);
        if (!compares) continue;
        expect(
          squeezed(comparison.map((part) => textOf(part.ops)).join('')),
          `${name} ${locale}`,
        ).toBe(squeezed(COMPARISON_SENTENCE[locale]));
      }
    }
  });

  it('print the agreement’s sentences where the old report had its own, and nothing else there', () => {
    const squeezed = (text: string) => [...text.replace(/\s+/g, '')].sort().join('');
    for (const name of CASE_NAMES) {
      for (const locale of LOCALES) {
        const standing = laid(name, locale)
          .sheets.flatMap((sheet) => sheet.parts)
          .filter((part) => part.id.startsWith('final.standing'));
        expect(
          squeezed(standing.map((part) => textOf(part.ops)).join('')),
          `${name} ${locale}`,
        ).toBe(squeezed(STANDING_SENTENCES.map((sentence) => sentence[locale]).join('')));
      }
    }
  });

  it('leave out, for a brain map only, what belongs to a programme, and keep the rest', () => {
    for (const locale of LOCALES) {
      const say = (key: string) => phrase(key, 'initial', locale);
      const text = laid('qeegOnly', locale)
        .sheets.flatMap((sheet) => sheet.parts.map((part) => textOf(part.ops)))
        .join(' ');
      const opening = (key: string) => say(key).split(' ').slice(0, 4).join(' ');
      expect(text).not.toContain(say('heading.approach'));
      expect(text).not.toContain(opening('text.programme_length'));
      expect(text).not.toContain(opening('text.approach'));
      const agreed = laid('full', locale)
        .sheets.flatMap((sheet) => sheet.parts.map((part) => textOf(part.ops)))
        .join(' ');
      expect(agreed).toContain(say('heading.approach'));
      expect(agreed).toContain(opening('text.programme_length'));
      expect(agreed).toContain(opening('text.approach'));
      // The practice's answer of 30 September 2026: the whole training
      // recommendation goes on a brain map only.
      expect(text).not.toContain(opening('text.monitoring'));
      expect(text).not.toContain(opening('text.gradual'));
      expect(text).not.toContain(opening('text.programme'));
      expect(text).not.toContain(say('heading.programme'));
      expect(agreed).toContain(say('heading.programme'));
      expect(agreed).toContain(opening('text.monitoring'));
      expect(text).toContain(WORDS.signedBy[locale]);
      const programme = laid('qeegOnly', locale)
        .sheets.flatMap((sheet) => sheet.parts)
        .map((part) => part.id);
      expect(programme).toContain('final.note');
      expect(programme).not.toContain('programme.length');
      expect(programme).not.toContain('programme.sessions');
      expect(programme).not.toContain('approach.line');
    }
  });
});

describe('a follow-up on paper', () => {
  it('prints its page of what has changed on one page when it can, in either language', () => {
    // Every kind of part, her summary one sentence; and pictures and words alone.
    const content = fullFollowUp();
    const compact: QeegFollowUp = {
      ...content,
      change: {
        ...content.change,
        summary: {
          en: { text: 'Evenings are calmer since June.', marks: [] },
          ar: { text: 'أصبحت الأمسيات أهدأ منذ يونيو.', marks: [] },
        },
      },
    };
    const onChange = (result: Laid) =>
      result.sheets.filter((sheet) => sheet.parts.some((part) => part.id.startsWith('change.')));
    for (const locale of LOCALES) {
      expect(onChange(layoutQeegReport(inputOf(compact, locale), fonts)), locale).toHaveLength(1);
      expect(onChange(laid('followUpPictures', locale)), locale).toHaveLength(1);
    }
  });

  it('breaks a page of what has changed that cannot be one only between whole parts', () => {
    for (const locale of LOCALES) {
      const ids = laid('followUpLong', locale).sheets.flatMap((sheet) =>
        sheet.parts.map((part) => part.id),
      );
      expect(ids.filter((id) => /^change\.(pair\.|row\.|headlines).*\/[0-9]+$/.test(id))).toEqual(
        [],
      );
    }
  });

  it('draws a figure’s direction as a filled path in the ink, and never as a sign in its words', () => {
    for (const locale of LOCALES) {
      const parts = laid('followUpFull', locale)
        .sheets.flatMap((sheet) => sheet.parts)
        .filter((part) => part.id.startsWith('change.') || part.id === 'dashboard.grid');
      const triangles = parts.flatMap((part) =>
        part.ops.filter(
          (op) => op.kind === 'path' && op.fill?.grey === 0 && op.segments.length === 4,
        ),
      );
      // Seven on the page of what has changed, and four on the dashboard.
      expect(triangles, locale).toHaveLength(11);
      expect(parts.map((part) => textOf(part.ops)).join(' ')).not.toMatch(/[▲▼△▽↑↓≈]/);
    }
  });

  it('embeds every map it names once, without loss, drawn smooth: its own and the earlier ones', () => {
    const bytes = renderQeegReport(inputOf(fullFollowUp(), 'ar'), fonts);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).not.toContain('/DCTDecode');
    const maps = text.match(
      new RegExp(
        `/Width ${MAP_PIXELS.width} /Height ${MAP_PIXELS.height} [^>]*/Filter /FlateDecode[^]*?/Interpolate true`,
        'g',
      ),
    );
    expect(maps).toHaveLength(4);
  });

  it('renders to the same bytes twice', () => {
    for (const locale of LOCALES) {
      const input = inputOf(fullFollowUp(), locale);
      const digest = () =>
        createHash('sha256').update(renderQeegReport(input, fonts)).digest('hex');
      expect(digest()).toBe(digest());
    }
  });
});

describe('the file', () => {
  it('renders to the same bytes twice', () => {
    for (const locale of LOCALES) {
      const input = inputOf(fullReport(), locale);
      const digest = () =>
        createHash('sha256').update(renderQeegReport(input, fonts)).digest('hex');
      expect(digest()).toBe(digest());
    }
  });

  it('embeds each map without loss, and asks for it to be drawn smooth', () => {
    const bytes = renderQeegReport(inputOf(fullReport(), 'en'), fonts);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text).not.toContain('/DCTDecode');
    const maps = text.match(
      new RegExp(
        `/Width ${MAP_PIXELS.width} /Height ${MAP_PIXELS.height} [^>]*/Filter /FlateDecode[^]*?/Interpolate true`,
        'g',
      ),
    );
    expect(maps).toHaveLength(2);
    expect(text).toContain('/Width 52 /Height 26');
  });

  it('draws bold Arabic in the bold Arabic face', () => {
    const bytes = renderQeegReport(inputOf(fullReport(), 'ar'), fonts);
    expect(new TextDecoder('latin1').decode(bytes)).toContain(
      '/BaseFont /IBMPlexSansArabic-SemiBold',
    );
  });

  it('lays out a follow-up and files it, where the first report’s refusal once stood', () => {
    for (const locale of LOCALES) {
      const input = inputOf(fullFollowUp(), locale);
      expect(layoutQeegReport(input, fonts).overflowing).toEqual([]);
      const bytes = renderQeegReport(input, fonts);
      expect(new TextDecoder('latin1').decode(bytes.slice(0, 5))).toBe('%PDF-');
    }
  });

  it('refuses content the shape does not accept, naming the field', () => {
    const content = { ...fullReport(), plan: { sessions: 20, approach: 'soothing' } };
    expect(() =>
      layoutQeegReport(
        { content: content as unknown as QeegInitial, locale: 'en', facts: factsFor(fullReport()) },
        fonts,
      ),
    ).toThrow(/refused at plan\.approach/);
  });
});
