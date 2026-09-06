import { describe, expect, it } from 'vitest';
import { minimalEdf, nativeRecording } from '../../tests/assessment/fixtures/edf';
import {
  ASSESSMENT_FILE_MIME_TYPES,
  NATIVE_RECORDING_EXTENSION,
  bytesAreAnEdf,
  classifyAssessmentFile,
  normaliseExtension,
} from './fileType';

/**
 * What an export may be (docs/SPEC/assessment.md decision 3, amended on the
 * founder's equipment answer of 2026-09-06).
 *
 * Three kinds, and each is recognised by what the bytes say rather than by
 * what the caller calls them. The four media types the platform already knows
 * are `domain/shared/fileSignature.ts`'s question and are tested there; what
 * is asserted here is this stream's own decision — which kinds an assessment
 * may hold, and how each is told apart.
 *
 * The EDF fixture is built from the published layout in
 * `tests/assessment/fixtures/edf.ts`, never copied from a recording.
 *
 * The signature itself is `domain/shared/fileSignature.ts`'s from the trunk's
 * round 33 and is tested there; `bytesAreAnEdf` is re-exported from this module
 * so no caller moved, and one case below reads it through that re-export.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MARKUP = new TextEncoder().encode('<html><body>anything</body></html>');

function classify(
  bytes: Uint8Array,
  declaredMimeType: string,
  extension: string | null = null,
): ReturnType<typeof classifyAssessmentFile> {
  return classifyAssessmentFile({ bytes, declaredMimeType, extension });
}

describe('the vendor’s report', () => {
  it('accepts bytes that begin as a PDF does', () => {
    expect(classify(PDF, 'application/pdf')).toEqual({ ok: true, kind: 'vendor_pdf' });
  });

  it('refuses an HTML page called a report', () => {
    expect(classify(MARKUP, 'application/pdf')).toEqual({ ok: false, reason: 'not_a_pdf' });
  });

  it('refuses a picture called a report', () => {
    expect(classify(PNG, 'application/pdf')).toEqual({ ok: false, reason: 'not_a_pdf' });
  });

  it('refuses bytes too short to say anything', () => {
    expect(classify(new Uint8Array([0x25, 0x50]), 'application/pdf').ok).toBe(false);
    expect(classify(new Uint8Array(), 'application/pdf').ok).toBe(false);
  });
});

describe('the EDF recording', () => {
  it('accepts a header beginning with the version and its seven spaces', () => {
    expect(classify(minimalEdf(), 'application/octet-stream')).toEqual({
      ok: true,
      kind: 'edf_recording',
    });
  });

  it('asks the shared question, through the name this module still exports', () => {
    // The re-export, not a copy: the same answer the shared module gives.
    expect(bytesAreAnEdf(minimalEdf())).toBe(true);
    expect(bytesAreAnEdf(MARKUP)).toBe(false);
  });

  it('reads the signature rather than the name the file was chosen under', () => {
    // The bytes are the stronger word. A recording renamed on somebody's
    // laptop is still a recording, and a name is not evidence of anything.
    expect(classify(minimalEdf(), 'application/octet-stream', 'dat')).toEqual({
      ok: true,
      kind: 'edf_recording',
    });
  });

  it('refuses a version byte that is not the one the format fixes', () => {
    const wrong = minimalEdf();
    wrong[0] = 0x31;
    expect(classify(wrong, 'application/octet-stream')).toEqual({
      ok: false,
      reason: 'not_a_recording',
    });
  });

  it('refuses a header whose seven spaces are something else', () => {
    const wrong = minimalEdf();
    wrong[4] = 0x41;
    expect(classify(wrong, 'application/octet-stream')).toEqual({
      ok: false,
      reason: 'not_a_recording',
    });
  });

  it('refuses an EDF offered as a PDF', () => {
    expect(classify(minimalEdf(), 'application/pdf')).toEqual({
      ok: false,
      reason: 'not_a_pdf',
    });
  });
});

describe('the amplifier software’s own recording', () => {
  it('accepts binary bytes chosen under the recording’s extension', () => {
    expect(
      classify(nativeRecording(), 'application/octet-stream', NATIVE_RECORDING_EXTENSION),
    ).toEqual({ ok: true, kind: 'native_recording' });
  });

  it('refuses the same bytes when no extension came with them', () => {
    // The extension is the whole of what tells this kind apart, so a caller
    // that sends none has said nothing and the door has nothing to go on.
    expect(classify(nativeRecording(), 'application/octet-stream')).toEqual({
      ok: false,
      reason: 'not_a_recording',
    });
  });

  it('refuses a page of markup under the recording’s extension', () => {
    expect(classify(MARKUP, 'application/octet-stream', NATIVE_RECORDING_EXTENSION)).toEqual({
      ok: false,
      reason: 'not_a_recording',
    });
  });

  it('refuses markup behind whitespace or a byte-order mark', () => {
    // A browser reads past both before it reads anything, so a fence that
    // looked only at the first byte would have been reading a different file
    // from the one that would eventually be rendered.
    const BOM = [0xef, 0xbb, 0xbf];
    const leading: readonly number[][] = [
      [0x0a],
      [0x20, 0x20, 0x09],
      [0x0d, 0x0a],
      [0x0c],
      BOM,
      [...BOM, 0x0a, 0x20],
    ];
    for (const prefix of leading) {
      const bytes = new Uint8Array([...prefix, ...MARKUP]);
      expect(classify(bytes, 'application/octet-stream', NATIVE_RECORDING_EXTENSION)).toEqual({
        ok: false,
        reason: 'not_a_recording',
      });
    }
  });

  it('still takes a recording whose own bytes begin with one of those', () => {
    // The fence reads past whitespace to find markup, and finds none: a
    // recording that happens to open with a space is a recording.
    const bytes = new Uint8Array([0x20, 0x0a, ...nativeRecording()]);
    expect(classify(bytes, 'application/octet-stream', NATIVE_RECORDING_EXTENSION)).toEqual({
      ok: true,
      kind: 'native_recording',
    });
  });

  it('refuses something the platform already recognises as another type', () => {
    // A PDF renamed to the recording's extension is a mislabelled PDF, and a
    // door that took it would hold a document nothing could read as what its
    // row says it is.
    for (const bytes of [PDF, PNG]) {
      expect(classify(bytes, 'application/octet-stream', NATIVE_RECORDING_EXTENSION)).toEqual({
        ok: false,
        reason: 'not_a_recording',
      });
    }
  });

  it('refuses an empty file', () => {
    expect(
      classify(new Uint8Array(), 'application/octet-stream', NATIVE_RECORDING_EXTENSION),
    ).toEqual({ ok: false, reason: 'not_a_recording' });
  });
});

describe('the media types the door takes', () => {
  it('names two and only two', () => {
    expect([...ASSESSMENT_FILE_MIME_TYPES]).toEqual([
      'application/pdf',
      'application/octet-stream',
    ]);
  });

  it('refuses every other declared type outright', () => {
    for (const type of ['image/png', 'text/html', 'application/json', '', 'application/x-edf']) {
      expect(classify(PDF, type)).toEqual({ ok: false, reason: 'unsupported_media_type' });
    }
  });
});

describe('reading an extension the chooser sent', () => {
  it('takes the dot off and lower-cases what is left', () => {
    expect(normaliseExtension('.EEG')).toBe('eeg');
    expect(normaliseExtension('eeg')).toBe('eeg');
    expect(normaliseExtension('EDF')).toBe('edf');
  });

  it('answers nothing for what is not an extension', () => {
    // A whole file name is refused rather than split: the practice's own file
    // names carry people's names, and this door has no business holding one.
    expect(normaliseExtension('a-person.eeg')).toBeNull();
    expect(normaliseExtension('')).toBeNull();
    expect(normaliseExtension('.')).toBeNull();
    expect(normaliseExtension('eeg/../../etc')).toBeNull();
    expect(normaliseExtension('e'.repeat(17))).toBeNull();
    expect(normaliseExtension(null)).toBeNull();
  });
});
