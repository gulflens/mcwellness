import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The manifest installs the whole app, not the practitioner's phone alone
 * (docs/SPEC/desktop-install.md).
 *
 * It opened at `/today` until 2026-09-12, so installing it on the office's PC
 * gave a window that opened on the day sheet every launch. `/` is right for
 * everyone, because the app routes each person home by role.
 */
const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as {
  start_url: string;
  orientation?: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
  shortcuts?: { name: string; url: string }[];
};

/** A PNG's own header: width and height are big-endian 32-bit at byte 16. */
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the installable manifest', () => {
  it('opens the app, which sends each person to their own home', () => {
    expect(manifest.start_url).toBe('/');
  });

  it('forces no orientation, which means nothing on a desk', () => {
    expect(manifest.orientation).toBeUndefined();
  });

  it('offers Windows a square raster, at the sizes it asks for', () => {
    for (const [src, expected] of [
      ['/icon-192.png', 192],
      ['/icon-512.png', 512],
    ] as const) {
      expect(manifest.icons.some((icon) => icon.src === src)).toBe(true);
      expect(pngSize(`public${src}`)).toEqual({ width: expected, height: expected });
    }
  });

  it('offers Android a maskable icon, so a crop does not clip the mark', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  it('offers Safari the one format it accepts, at the size it asks for', () => {
    // Safari accepts no SVG for apple-touch-icon. index.html names this file.
    expect(readFileSync('index.html', 'utf8')).toContain('/apple-touch-icon.png');
    expect(pngSize('public/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('puts the three screens the office opens most on the taskbar', () => {
    expect((manifest.shortcuts ?? []).map((s) => s.url)).toEqual([
      '/admin/clients',
      '/admin/schedule',
      '/admin/billing',
    ]);
  });
});
