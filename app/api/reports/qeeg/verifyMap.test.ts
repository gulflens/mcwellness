import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { goodPng, handPng } from '../../../../tests/reports/db/figures-support';
import { FIGURE_SENTENCES } from './figureSchema';
import { verifyMap } from './verifyMap';

/**
 * The server's check that a brain map is exactly the picture the report
 * prints (docs/SPEC/reports-qeeg.md section 9, point 2): IHDR first, the image
 * data in one run of IDAT chunks, IEND last with nothing after it, and no
 * other chunk at all. Every picture here is synthetic.
 */

const base = { width: 4, height: 4 };

describe('verifyMap', () => {
  it('takes the PNG the browser writes', async () => {
    expect(verifyMap(await goodPng(12, 9, 1))).toEqual({ ok: true, widthPx: 12, heightPx: 9 });
  });

  it('takes image data split across consecutive IDAT chunks', () => {
    expect(verifyMap(handPng({ ...base, between: [] }))).toEqual({
      ok: true,
      widthPx: 4,
      heightPx: 4,
    });
  });

  it.each([
    ['tRNS', 'transparency'],
    ['PLTE', 'palette'],
    ['tEXt', 'text'],
    ['iTXt', 'text'],
    ['zTXt', 'text'],
    ['eXIf', 'metadata'],
    ['prVt', 'unknown_chunk'],
  ] as const)('refuses a %s chunk as %s', (type, code) => {
    expect(verifyMap(handPng({ ...base, before: [{ type }] }))).toEqual({ ok: false, code });
    expect(verifyMap(handPng({ ...base, after: [{ type }] }))).toEqual({ ok: false, code });
  });

  it('refuses image data split by another chunk', () => {
    expect(verifyMap(handPng({ ...base, between: [{ type: 'tEXt' }] }))).toEqual({
      ok: false,
      code: 'split_data',
    });
  });

  it('refuses bytes after the end', () => {
    expect(verifyMap(handPng({ ...base, trailer: new Uint8Array([0]) }))).toEqual({
      ok: false,
      code: 'trailing_bytes',
    });
  });

  it('refuses an interlaced picture', () => {
    expect(verifyMap(handPng({ ...base, interlace: 1 }))).toEqual({
      ok: false,
      code: 'interlaced',
    });
  });

  it('refuses a row whose filter byte PNG does not define', () => {
    expect(verifyMap(handPng({ ...base, filterByte: 5 }))).toEqual({ ok: false, code: 'damaged' });
  });

  it('refuses bytes hidden after the compressed stream inside the image data', () => {
    expect(
      verifyMap(handPng({ ...base, dataTrailer: new TextEncoder().encode('hidden words') })),
    ).toEqual({ ok: false, code: 'damaged' });
  });

  it('refuses a second compressed stream after the first', () => {
    const second = Uint8Array.from(deflateSync(new Uint8Array([1, 2, 3])));
    expect(verifyMap(handPng({ ...base, dataTrailer: second }))).toEqual({
      ok: false,
      code: 'damaged',
    });
  });

  it('refuses a chunk whose CRC is wrong', () => {
    expect(verifyMap(handPng({ ...base, badCrc: true }))).toEqual({ ok: false, code: 'damaged' });
  });

  it('refuses an image data chunk with nothing in it', () => {
    expect(verifyMap(handPng({ ...base, emptyIdat: true }))).toEqual({
      ok: false,
      code: 'damaged',
    });
  });

  it('refuses a header of twelve bytes as damaged, before reading its fields', () => {
    expect(verifyMap(handPng({ ...base, headerLength: 12 }))).toEqual({
      ok: false,
      code: 'damaged',
    });
  });

  it('has a sentence for every refusal', () => {
    for (const code of [
      'transparency',
      'palette',
      'text',
      'metadata',
      'unknown_chunk',
      'split_data',
      'trailing_bytes',
    ] as const) {
      expect(FIGURE_SENTENCES[code].length).toBeGreaterThan(20);
    }
  });
});
