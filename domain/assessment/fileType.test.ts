import { describe, expect, it } from 'vitest';
import { ASSESSMENT_FILE_MIME_TYPE, bytesAreAPdf } from './fileType';

/**
 * The one file type an export may be (docs/SPEC/assessment.md decision 3).
 *
 * The bytes are `domain/shared/fileSignature.ts`'s question and are tested
 * there, over all four media types the platform holds. What is asserted here
 * is that this stream still asks it, and still about one type only.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

describe('what an export may be', () => {
  it('accepts bytes that begin as a PDF does', () => {
    expect(bytesAreAPdf(PDF)).toBe(true);
  });

  it('refuses an HTML page called a report', () => {
    expect(bytesAreAPdf(new TextEncoder().encode('<html><body>anything</body></html>'))).toBe(
      false,
    );
  });

  it('refuses a picture', () => {
    expect(bytesAreAPdf(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe(false);
  });

  it('refuses bytes too short to say anything', () => {
    expect(bytesAreAPdf(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(bytesAreAPdf(new Uint8Array())).toBe(false);
  });

  it('names one media type and only one', () => {
    expect(ASSESSMENT_FILE_MIME_TYPE).toBe('application/pdf');
  });
});
