// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import qrcode from 'qrcode-generator';
import { afterEach, describe, expect, it } from 'vitest';
import { ExpoPosterPage, expoAddress, qrPath } from './ExpoPosterPage';

afterEach(cleanup);

describe('ExpoPosterPage', () => {
  it("draws a code that encodes this origin's /expo address", () => {
    render(<ExpoPosterPage />);
    const address = expoAddress(window.location.origin);
    const inWords = address.replace(/^https?:\/\//, '');
    const picture = screen.getByRole('img', { name: `QR code for ${inWords}` });
    // The same encoder, run again on the same text, agrees on every module.
    const code = qrcode(0, 'M');
    code.addData(address);
    code.make();
    const modules = code.getModuleCount();
    expect(picture.getAttribute('viewBox')).toBe(`0 0 ${modules + 8} ${modules + 8}`);
    const d = picture.querySelector('path')?.getAttribute('d') ?? '';
    let dark = 0;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (code.isDark(row, col)) {
          dark += 1;
          expect(d).toContain(`M${col + 4} ${row + 4}h1v1h-1z`);
        }
      }
    }
    expect(d.split('M').length - 1).toBe(dark);
    expect(screen.getByText(inWords)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  it("heads the sheet with the practice's lockup, named for a reader who cannot see it", () => {
    render(<ExpoPosterPage />);
    const lockup = screen.getByRole('img', { name: 'McWellness' });
    expect(lockup.getAttribute('src')).toBe('/brand/lockup.png');
    // The sheet is what prints: the lockup is on it and the Print button is not.
    const sheet = lockup.closest('.poster__sheet');
    expect(sheet).toBeTruthy();
    expect(sheet?.contains(screen.getByRole('button', { name: 'Print' }))).toBe(false);
  });

  it('sizes the printed sheet by the paper it measures, never by what a browser claims', () => {
    // Pagination cannot be run here, so this guards the decision instead. Safari
    // passes `@supports (page: auto)` and still keeps its own margins; sized on
    // that claim, the sheet was followed by a blank second page (19 September
    // 2026, printed through WebKit). The whole sheet is for paper measured to be
    // A4 from edge to edge, and everything else gets the sheet that fits.
    // The rules, not the prose: the stylesheet's own comments tell this history
    // and name the rule that went, so they are set aside before anything is read.
    const css = readFileSync('app/admin/enquiries/poster.css', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    expect(css).not.toContain('@supports (page');
    expect(css).toContain('container: poster-paper / inline-size');
    expect(css).toMatch(
      /@container poster-paper \(min-width: 209\.5mm\) and \(max-width: 210\.5mm\)/,
    );
    expect(css).toContain('max-inline-size: 170mm');
    // Safari refuses the orientation keyword and drops the declaration whole.
    expect(css).toMatch(/@page poster \{\s*size: A4;/);
  });

  it('keeps a quiet zone of four modules on every side', () => {
    const { d, size } = qrPath('https://app.mcwellnessuae.com/expo');
    const code = qrcode(0, 'M');
    code.addData('https://app.mcwellnessuae.com/expo');
    code.make();
    expect(size).toBe(code.getModuleCount() + 8);
    // The first dark module is the finder pattern's corner, inset by the zone.
    expect(d.startsWith('M4 4h1v1h-1z')).toBe(true);
  });
});
