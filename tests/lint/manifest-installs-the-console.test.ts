import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
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

/**
 * The top-left pixel's alpha, read out of the PNG itself: inflate the image
 * data, skip the first scanline's filter byte, and take the fourth channel.
 * Every file here is written unfiltered by the rasteriser that makes them.
 */
function cornerPixel(file: string): { alpha: number } {
  const bytes = readFileSync(file);
  let at = 8;
  const parts: Buffer[] = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const tag = bytes.subarray(at + 4, at + 8).toString('ascii');
    if (tag === 'IDAT') parts.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  expect(raw[0]).toBe(0);
  return { alpha: raw[4] ?? -1 };
}

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
    const maskable = manifest.icons.find((icon) => icon.purpose === 'maskable');
    expect(maskable?.src).toBe('/icon-512-maskable.png');
    expect(pngSize('public/icon-512-maskable.png')).toEqual({ width: 512, height: 512 });
  });

  it('gives each platform the corner it wants', () => {
    // The first cut of these icons was rasterised by macOS Quick Look, which
    // composites onto a white matte: all three came out with opaque white
    // wedges where the mark's rounded square is transparent, which on a dark
    // taskbar is the poor icon the round set out to end. So the corner is the
    // property held here (docs/SPEC/desktop-install.md section 5).
    //
    // Rounded and transparent where a browser puts the mark on its own ground;
    // full bleed and opaque where the platform masks it itself — Android crops
    // a maskable icon, and Apple renders transparency as black.
    expect(cornerPixel('public/icon-192.png').alpha).toBe(0);
    expect(cornerPixel('public/icon-512.png').alpha).toBe(0);
    expect(cornerPixel('public/icon-512-maskable.png').alpha).toBe(255);
    expect(cornerPixel('public/apple-touch-icon.png').alpha).toBe(255);
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
