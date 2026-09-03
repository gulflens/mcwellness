// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressToFit, readFileForUpload } from './fileUpload';

/**
 * Preparing a file for a body that must be JSON and must fit
 * (app/api/create-api.ts's `BODY_LIMIT_BYTES`).
 *
 * The scaling loop needs `createImageBitmap` and a canvas encoder, neither of
 * which jsdom has; what is worth pinning without them is the shape of every
 * refusal, because each one is a sentence somebody reads while standing in a
 * client's living room.
 */

function fileOf(name: string, type: string, bytes: Uint8Array): File {
  // A fresh ArrayBuffer, because `BlobPart` wants one that is definitely not
  // shared and a Uint8Array's buffer is only known to be array-buffer-like.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type });
}

const PDF = new TextEncoder().encode('%PDF-1.7\nsynthetic\n');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A photograph the browser can actually scale: jsdom has neither
 * `createImageBitmap` nor a canvas encoder, so both are stood in for. The
 * stand-in encoder returns a size proportional to pixels times quality, which
 * is the only property of a JPEG encoder the ladder depends on, and records
 * every attempt so the *order* of the ladder can be asserted rather than only
 * its answer.
 */
function stubEncoder(): { width: number; quality: number }[] {
  const attempts: { width: number; quality: number }[] = [];
  vi.stubGlobal('createImageBitmap', async () => ({
    width: 3000,
    height: 4000,
    close: () => undefined,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => ({ drawImage: () => undefined }) as never,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(function (
    this: HTMLCanvasElement,
    _type?: string,
    quality?: unknown,
  ) {
    const q = Number(quality);
    attempts.push({ width: this.width, quality: q });
    const bytes = Math.round((this.width * this.height * q) / 4000);
    return `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
  });
  return attempts;
}

describe('compressToFit', () => {
  it('sends a small PDF as it stands', async () => {
    const prepared = await compressToFit(fileOf('form.pdf', 'application/pdf', PDF), 1024);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.file.mimeType).toBe('application/pdf');
      expect(prepared.file.name).toBe('form.pdf');
      expect(Buffer.from(prepared.file.bytesBase64, 'base64').toString('utf8')).toContain('%PDF');
    }
  });

  it('refuses a large PDF and says what to do instead', async () => {
    const prepared = await compressToFit(fileOf('form.pdf', 'application/pdf', PDF), 4);
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.message).toContain('Photograph the signed form instead');
    }
  });

  it('refuses a kind of file the practice does not hold', async () => {
    const prepared = await compressToFit(
      fileOf('notes.txt', 'text/plain', new TextEncoder().encode('hello')),
      1024,
    );
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.message).toContain('not one this practice holds');
    }
  });

  it('sends a photograph that already fits without re-encoding it', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const prepared = await compressToFit(fileOf('scan.png', 'image/png', png), 1024);
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      // Still a PNG, byte for byte: nothing was thrown away that did not need to be.
      expect(prepared.file.mimeType).toBe('image/png');
      expect(Buffer.from(prepared.file.bytesBase64, 'base64')).toEqual(Buffer.from(png));
    }
  });
});

describe('making a photograph fit', () => {
  it('makes it smaller before it makes it worse', async () => {
    // 0.4 quality at full size is where handwriting turns to porridge. Fewer
    // pixels of clean ink beats the same page smeared, so every size is tried
    // at the best quality before the quality moves at all.
    const attempts = stubEncoder();
    const prepared = await compressToFit(
      fileOf('form.jpg', 'image/jpeg', new Uint8Array(3000).fill(1)),
      500,
    );
    expect(prepared.ok).toBe(true);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.every((attempt) => attempt.quality === 0.8)).toBe(true);
    // Descending, and never below the long-edge floor while quality remains.
    expect(attempts.map((attempt) => attempt.width)).toEqual([1800, 1500, 1275]);
    if (prepared.ok) {
      expect(prepared.file.mimeType).toBe('image/jpeg');
      expect(prepared.warning).toBeUndefined();
    }
  });

  it('says so when a page had to go below what can be read', async () => {
    const attempts = stubEncoder();
    const prepared = await compressToFit(
      fileOf('form.jpg', 'image/jpeg', new Uint8Array(5000).fill(1)),
      100,
    );
    expect(prepared.ok).toBe(true);
    if (prepared.ok) {
      expect(prepared.warning).toContain('check the writing');
    }
    // The floor was reached at every quality before anything smaller was tried.
    expect(attempts.filter((attempt) => attempt.width === 1050)).toHaveLength(3);
    expect(attempts.at(-1)?.width).toBeLessThan(1050);
  });
});

describe('readFileForUpload', () => {
  it('encodes bytes without a data URL prefix, in chunks that do not overflow', async () => {
    // Larger than the 0x8000 chunk the encoder walks in, so the loop is real.
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(0x41);
    const encoded = await readFileForUpload(fileOf('big.bin', 'application/pdf', bytes));
    expect(encoded.startsWith('data:')).toBe(false);
    expect(Buffer.from(encoded, 'base64').length).toBe(bytes.length);
  });
});
