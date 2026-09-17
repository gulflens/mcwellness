// @vitest-environment jsdom
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
