import { describe, expect, it } from 'vitest';
import { keepOrDefault } from './NewAppointmentDrawer';

/**
 * The one rule behind every default in the booking drawer (the usability pass
 * of 2026-09-14), stated without a screen around it.
 */
const A = { id: 'a' };
const B = { id: 'b' };

describe('keepOrDefault', () => {
  it('keeps a choice already made, when the fresh options still offer it', () => {
    expect(keepOrDefault('b', [A, B], 'a')).toBe('b');
  });

  it('drops a choice the fresh options no longer offer, rather than showing a stale pick', () => {
    expect(keepOrDefault('c', [A, B], null)).toBeNull();
  });

  it('takes the only option', () => {
    expect(keepOrDefault(null, [A], null)).toBe('a');
  });

  it('takes the remembered option when it is still offered, and not otherwise', () => {
    expect(keepOrDefault(null, [A, B], 'b')).toBe('b');
    expect(keepOrDefault(null, [A, B], 'gone')).toBeNull();
  });

  it('never guesses among several', () => {
    expect(keepOrDefault(null, [A, B], null)).toBeNull();
    expect(keepOrDefault(null, [], null)).toBeNull();
  });
});
