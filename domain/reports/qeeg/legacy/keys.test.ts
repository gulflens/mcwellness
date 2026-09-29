import { describe, expect, it } from 'vitest';
import type { Provenance } from '../types';
import { LEGACY_FORMAT, LEGACY_SUBJECT_KEY, LEGACY_VERSION } from './keys';

describe('the old file format, by name', () => {
  it('names the format a past record says it came from', () => {
    const format: Extract<Provenance, { origin: 'legacy_tool' }>['format'] = LEGACY_FORMAT;
    expect(format).toBe('qeeg.json/1');
  });

  it('reads the one version the old tool ever wrote', () => {
    expect(LEGACY_VERSION).toBe(1);
  });

  it('names the key the old file keeps the person under as a plain lower-case word', () => {
    expect(LEGACY_SUBJECT_KEY).toMatch(/^[a-z]+$/);
  });

  it('holds the key as a string that is not empty', () => {
    expect(typeof LEGACY_SUBJECT_KEY).toBe('string');
    expect(LEGACY_SUBJECT_KEY.length).toBeGreaterThan(0);
  });
});
