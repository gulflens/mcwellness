import { describe, expect, it } from 'vitest';
import {
  checkExternalUpload,
  EXTERNAL_REPORT_MAX_BYTES,
  EXTERNAL_TITLE_MAX,
  externalTitleOf,
} from './external';

/**
 * An uploaded report (kind `external`, migrations 607 and 608): a PDF the
 * practice made in another tool, filed against a client and put in front of
 * the household as it is. The rule is what a filing must be before a row is
 * written: a PDF by its bytes, not empty, not over the cap, with a title and
 * a report date that has already happened.
 */

const TODAY = '2026-10-06';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a]);

function upload(over: Partial<Parameters<typeof checkExternalUpload>[0]> = {}) {
  return checkExternalUpload({
    title: 'Brain map, initial',
    reportDate: '2026-10-01',
    bytes: PDF,
    today: TODAY,
    ...over,
  });
}

describe('checkExternalUpload', () => {
  it('accepts a PDF with a title and a past date, and tidies the title', () => {
    expect(upload({ title: '  Brain   map,\tinitial ' })).toEqual({
      ok: true,
      title: 'Brain map, initial',
      reportDate: '2026-10-01',
    });
  });

  it('accepts a report dated today', () => {
    expect(upload({ reportDate: TODAY }).ok).toBe(true);
  });

  it('refuses bytes that are not a PDF, whatever they are called', () => {
    const html = new TextEncoder().encode('<html><body>report</body></html>');
    expect(upload({ bytes: html })).toEqual({ ok: false, code: 'not_a_pdf' });
  });

  it('refuses an empty file', () => {
    expect(upload({ bytes: new Uint8Array(0) })).toEqual({ ok: false, code: 'empty_file' });
  });

  it('refuses a file over the cap', () => {
    const big = new Uint8Array(EXTERNAL_REPORT_MAX_BYTES + 1);
    big.set(PDF);
    expect(upload({ bytes: big })).toEqual({ ok: false, code: 'too_many_bytes' });
  });

  it('caps at twenty megabytes', () => {
    expect(EXTERNAL_REPORT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });

  it('refuses a missing or blank title', () => {
    expect(upload({ title: '' })).toEqual({ ok: false, code: 'no_title' });
    expect(upload({ title: ` ${String.fromCharCode(0x200b)}\t ` })).toEqual({
      ok: false,
      code: 'no_title',
    });
  });

  it('refuses a title over the limit', () => {
    expect(upload({ title: 'a'.repeat(EXTERNAL_TITLE_MAX + 1) })).toEqual({
      ok: false,
      code: 'title_too_long',
    });
    expect(upload({ title: 'a'.repeat(EXTERNAL_TITLE_MAX) }).ok).toBe(true);
  });

  it('takes control characters out of a title rather than keeping them', () => {
    const answer = upload({ title: 'Brain\u0000 map\u0007' });
    expect(answer).toEqual({ ok: true, title: 'Brain map', reportDate: '2026-10-01' });
  });

  it('refuses a date that is not a calendar date', () => {
    expect(upload({ reportDate: '' })).toEqual({ ok: false, code: 'no_date' });
    expect(upload({ reportDate: '2026-02-30' })).toEqual({ ok: false, code: 'no_date' });
    expect(upload({ reportDate: '01/10/2026' })).toEqual({ ok: false, code: 'no_date' });
  });

  it('refuses a date after today', () => {
    expect(upload({ reportDate: '2026-10-07' })).toEqual({ ok: false, code: 'date_in_future' });
  });
});

describe('externalTitleOf', () => {
  it('reads the title an uploaded report carries', () => {
    expect(externalTitleOf('external', { title: 'Brain map', byteSize: 10 })).toBe('Brain map');
  });

  it('answers null for an erased one, and for every other kind', () => {
    expect(externalTitleOf('external', {})).toBeNull();
    expect(externalTitleOf('progress', { title: 'Not a title' })).toBeNull();
    expect(externalTitleOf('external', null)).toBeNull();
  });
});
