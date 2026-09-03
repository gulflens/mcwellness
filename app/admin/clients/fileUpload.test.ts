// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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

describe('readFileForUpload', () => {
  it('encodes bytes without a data URL prefix, in chunks that do not overflow', async () => {
    // Larger than the 0x8000 chunk the encoder walks in, so the loop is real.
    const bytes = new Uint8Array(0x8000 * 2 + 5).fill(0x41);
    const encoded = await readFileForUpload(fileOf('big.bin', 'application/pdf', bytes));
    expect(encoded.startsWith('data:')).toBe(false);
    expect(Buffer.from(encoded, 'base64').length).toBe(bytes.length);
  });
});
