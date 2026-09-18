import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { A4_MM, POSTER_MM, balancedLines, pdfFromJpeg, posterLayout } from './posterPdf';

const latin1 = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');

describe('pdfFromJpeg', () => {
  // Not a picture: the wrapper never reads the bytes it carries, which is the point.
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 0xff, 0xd9]);
  const pdf = pdfFromJpeg(jpeg, 2480, 3508, 'McWellness expo poster');
  const text = latin1(pdf);

  it('is one page of A4 holding the picture untouched', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Pages /Kids [3 0 R] /Count 1');
    expect(text).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(text).toContain('/Subtype /Image /Width 2480 /Height 3508');
    expect(text).toContain('/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode');
    expect(text).toContain(`/Length ${jpeg.length} >>`);
    const at = text.indexOf('stream\n', text.indexOf('/DCTDecode')) + 'stream\n'.length;
    expect(Array.from(pdf.slice(at, at + jpeg.length))).toEqual(Array.from(jpeg));
    expect(text).toContain('/Title (McWellness expo poster)');
  });

  it('draws the picture over the whole page and nothing else', () => {
    expect(text).toContain('q 595.28 0 0 841.89 0 0 cm /Im0 Do Q');
  });

  it('points every cross-reference at the object it names', () => {
    // A reader finds objects by these offsets alone, so one wrong byte is a
    // file that opens blank, or not at all, in the owner's Preview.
    const xrefAt = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(xrefAt, xrefAt + 5)).toBe('xref\n');
    const table = text.slice(xrefAt).split('\n');
    expect(table[1]).toBe('0 7');
    expect(table[2]).toBe('0000000000 65535 f ');
    for (let object = 1; object <= 6; object += 1) {
      const row = table[2 + object] ?? '';
      expect(row).toMatch(/^\d{10} 00000 n $/);
      const offset = Number(row.slice(0, 10));
      expect(text.slice(offset, offset + `${object} 0 obj`.length)).toBe(`${object} 0 obj`);
    }
    expect(text).toContain('/Size 7 /Root 1 0 R /Info 6 0 R');
  });

  it('keeps a title from closing its own string', () => {
    const odd = latin1(pdfFromJpeg(jpeg, 1, 1, 'a (b) \\ c'));
    expect(odd).toContain('/Title (a \\(b\\) \\\\ c)');
  });
});

describe('balancedLines', () => {
  // One unit a character, so the arithmetic below can be read.
  const measure = (text: string): number => text.length;

  it('leaves a line that fits alone', () => {
    expect(balancedLines('Scan to tell us', 40, measure)).toEqual(['Scan to tell us']);
  });

  it('breaks two lines evenly rather than filling the first', () => {
    // Greedy at 26 wide would give "Scan to tell us about" and "yourself".
    expect(balancedLines('Scan to tell us about yourself', 26, measure)).toEqual([
      'Scan to tell us',
      'about yourself',
    ]);
    expect(
      balancedLines('Leave your details and we will be in touch after the expo.', 50, measure),
    ).toEqual(['Leave your details and we will', 'be in touch after the expo.']);
  });

  it('never drops a word that is wider than the line', () => {
    expect(balancedLines('app.mcwellnessuae.com/expo now', 10, measure)).toEqual([
      'app.mcwellnessuae.com/expo',
      'now',
    ]);
  });
});

describe('posterLayout', () => {
  const layout = posterLayout({ titleLines: 2, ledeLines: 2 });

  it('stands the four parts between the bars with equal gaps', () => {
    const { bars, lockup, title, lede, frame, address } = layout;
    expect(bars.top.y).toBe(14);
    expect(bars.bottom.y + bars.bottom.height).toBe(A4_MM.height - 14);
    const gaps = [
      title.y - (lockup.y + lockup.height),
      frame.y - (lede.y + lede.height),
      address.y - (frame.y + frame.size),
    ];
    expect(gaps[0]).toBeGreaterThanOrEqual(POSTER_MM.minGap);
    expect(gaps[1]).toBeCloseTo(gaps[0] ?? 0, 6);
    expect(gaps[2]).toBeCloseTo(gaps[0] ?? 0, 6);
    // First part against the top padding, last against the bottom one.
    expect(lockup.y).toBeCloseTo(14 + 3 + 9, 6);
    expect(address.y + address.height).toBeCloseTo(A4_MM.height - 14 - 3 - 9, 6);
  });

  it('centres everything on the sheet', () => {
    expect(layout.lockup.x + layout.lockup.width / 2).toBeCloseTo(A4_MM.width / 2, 6);
    expect(layout.frame.x + layout.frame.size / 2).toBeCloseTo(A4_MM.width / 2, 6);
  });

  it('measures what the stylesheet measures', () => {
    // Two descriptions of one sheet. The stylesheet draws the page and this
    // module draws the file, and nothing but this test keeps them the same
    // sheet: every length below is read out of poster.css, in its own `--mm`.
    const css = readFileSync('app/admin/enquiries/poster.css', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    const mm = (selector: string, property: string): number => {
      const block = new RegExp(`\\${selector} \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      const value = new RegExp(`${property}: calc\\(var\\(--mm\\) \\* ([\\d.]+)\\)`).exec(block);
      return Number(value?.[1]);
    };
    expect(mm('.poster__page', 'margin')).toBe(POSTER_MM.margin);
    expect(mm('.poster__page', 'padding-block')).toBe(POSTER_MM.padding);
    expect(mm('.poster__page', 'gap')).toBe(POSTER_MM.minGap);
    expect(css).toContain(`border-block: calc(var(--mm) * ${POSTER_MM.bar}) solid var(--brand)`);
    expect(mm('.poster__lockup', 'inline-size')).toBe(POSTER_MM.lockupWidth);
    expect(mm('.poster__invite', 'gap')).toBe(POSTER_MM.inviteGap);
    expect(mm('.poster__invite', 'max-inline-size')).toBe(POSTER_MM.inviteWidth);
    expect(mm('.poster__title', 'font-size')).toBe(POSTER_MM.title.size);
    expect(mm('.poster__title', 'line-height')).toBe(POSTER_MM.title.line);
    expect(mm('.poster__lede', 'font-size')).toBe(POSTER_MM.lede.size);
    expect(mm('.poster__lede', 'line-height')).toBe(POSTER_MM.lede.line);
    expect(mm('.poster__frame', 'inline-size')).toBe(POSTER_MM.frame.size);
    expect(mm('.poster__frame', 'padding')).toBe(POSTER_MM.frame.padding);
    expect(mm('.poster__frame', 'border-radius')).toBe(POSTER_MM.frame.radius);
    expect(css).toContain(`border: calc(var(--mm) * ${POSTER_MM.frame.border}) solid var(--brand)`);
    expect(mm('.poster__address', 'font-size')).toBe(POSTER_MM.address.size);
    expect(mm('.poster__address', 'line-height')).toBe(POSTER_MM.address.line);
  });
});
