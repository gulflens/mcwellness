import { describe, expect, it } from 'vitest';
import {
  KNOWN_MIME_TYPES,
  bytesAreAnEdf,
  bytesMatchMimeType,
  isKnownMimeType,
} from './fileSignature';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const html = new TextEncoder().encode('<!doctype html><script>alert(1)</script>');

describe('bytesMatchMimeType', () => {
  it('recognises each type it holds', () => {
    expect(bytesMatchMimeType(png, 'image/png')).toBe(true);
    expect(bytesMatchMimeType(jpeg, 'image/jpeg')).toBe(true);
    expect(bytesMatchMimeType(webp, 'image/webp')).toBe(true);
    expect(bytesMatchMimeType(pdf, 'application/pdf')).toBe(true);
  });

  it('refuses a page dressed as an image', () => {
    for (const mimeType of KNOWN_MIME_TYPES) {
      expect(bytesMatchMimeType(html, mimeType)).toBe(false);
    }
  });

  it('refuses one image type declared as another', () => {
    expect(bytesMatchMimeType(png, 'image/jpeg')).toBe(false);
    expect(bytesMatchMimeType(jpeg, 'application/pdf')).toBe(false);
  });

  it('refuses a type it does not check, rather than waving it through', () => {
    expect(bytesMatchMimeType(png, 'image/svg+xml')).toBe(false);
    expect(bytesMatchMimeType(png, 'text/html')).toBe(false);
  });

  it('refuses bytes too short to carry the signature', () => {
    expect(bytesMatchMimeType(Uint8Array.from([0x89, 0x50]), 'image/png')).toBe(false);
    expect(bytesMatchMimeType(Uint8Array.from([]), 'application/pdf')).toBe(false);
    // RIFF with nothing after it is not a WebP.
    expect(bytesMatchMimeType(Uint8Array.from([0x52, 0x49, 0x46, 0x46]), 'image/webp')).toBe(false);
  });

  it('refuses a RIFF container that is not WebP', () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(bytesMatchMimeType(wav, 'image/webp')).toBe(false);
  });
});

describe('isKnownMimeType', () => {
  it('names the four and nothing else', () => {
    expect(isKnownMimeType('image/png')).toBe(true);
    expect(isKnownMimeType('image/gif')).toBe(false);
  });
});

describe('bytesAreAnEdf', () => {
  /** The version field, and nothing after it: what every EDF and EDF+ begins with. */
  const version = (): Uint8Array => new TextEncoder().encode('0       ');

  it('accepts the version field the published format fixes', () => {
    // EDF and EDF+ begin the same eight bytes, so one case covers both.
    expect(bytesAreAnEdf(version())).toBe(true);
    const withHeader = new Uint8Array(256);
    withHeader.set(version());
    expect(bytesAreAnEdf(withHeader)).toBe(true);
  });

  it('refuses seven bytes, which cannot carry the field', () => {
    expect(bytesAreAnEdf(version().slice(0, 7))).toBe(false);
    expect(bytesAreAnEdf(new Uint8Array())).toBe(false);
  });

  it('refuses a nought followed by anything but seven spaces', () => {
    const padded = new TextEncoder().encode('0      X');
    expect(bytesAreAnEdf(padded)).toBe(false);
    const zeroes = new Uint8Array([0x30, 0, 0, 0, 0, 0, 0, 0]);
    expect(bytesAreAnEdf(zeroes)).toBe(false);
    const wrongVersion = version();
    wrongVersion[0] = 0x31;
    expect(bytesAreAnEdf(wrongVersion)).toBe(false);
  });

  it('refuses a page dressed as a recording', () => {
    expect(bytesAreAnEdf(html)).toBe(false);
  });
});
