// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import qrcode from 'qrcode-generator';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it("offers the poster as a file, made from this page's own address and code", async () => {
    // Safari draws its own date and address on any page it prints, and none on
    // a PDF, so the file is the way to a clean sheet there.
    const makePdf = vi.fn(() => Promise.resolve(Uint8Array.from([1, 2, 3])));
    const savePdf = vi.fn();
    render(<ExpoPosterPage makePdf={makePdf} savePdf={savePdf} />);
    const button = screen.getByRole('button', { name: 'Download PDF' });
    expect(button.closest('.poster__sheet')).toBeNull();

    fireEvent.click(button);
    await waitFor(() => expect(savePdf).toHaveBeenCalledTimes(1));
    const address = expoAddress(window.location.origin);
    expect(makePdf).toHaveBeenCalledWith({
      inWords: address.replace(/^https?:\/\//, ''),
      code: qrPath(address),
    });
    expect(savePdf).toHaveBeenCalledWith(Uint8Array.from([1, 2, 3]), 'McWellness-expo-poster.pdf');
    // Ready to be pressed again, and nothing said, because nothing went wrong.
    expect(screen.getByRole('button', { name: 'Download PDF' })).toHaveProperty('disabled', false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so in a sentence when the file cannot be made, and leaves Print standing', async () => {
    const makePdf = vi.fn(() => Promise.reject(new Error('no canvas')));
    const savePdf = vi.fn();
    render(<ExpoPosterPage makePdf={makePdf} savePdf={savePdf} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The PDF could not be made. Print this page instead.');
    expect(savePdf).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Print' })).toHaveProperty('disabled', false);
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
