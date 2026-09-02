import { describe, expect, it } from 'vitest';
import { requiredConsents } from './requiredConsents';
import type { ClientRecord } from './types';

function record(dateOfBirth: string | null): ClientRecord {
  return {
    client: { id: 'client-1', status: 'active', dateOfBirth },
    contacts: [],
    locations: [],
    consents: [],
  };
}

describe('requiredConsents', () => {
  it('always requires participation', () => {
    expect(requiredConsents(record('1990-01-01'), [], '2026-09-02')).toEqual(['participation']);
  });

  it('adds home_visit only when delivery includes home', () => {
    expect(requiredConsents(record('1990-01-01'), ['remote'], '2026-09-02')).toEqual([
      'participation',
    ]);
    expect(requiredConsents(record('1990-01-01'), ['home'], '2026-09-02')).toEqual([
      'home_visit',
      'participation',
    ]);
    expect(requiredConsents(record('1990-01-01'), ['home', 'remote'], '2026-09-02')).toEqual([
      'home_visit',
      'participation',
    ]);
  });

  it('adds minor_participation only while the client is a minor on atDate', () => {
    expect(requiredConsents(record('2010-01-01'), ['home'], '2026-09-02')).toEqual([
      'home_visit',
      'minor_participation',
      'participation',
    ]);
  });

  it('never requires minor_participation when the date of birth is not yet known', () => {
    expect(requiredConsents(record(null), ['home'], '2026-09-02')).toEqual([
      'home_visit',
      'participation',
    ]);
  });

  it('drops minor_participation the day the client turns eighteen', () => {
    // Born 2008-09-02: still seventeen on 2026-09-01, eighteen on 2026-09-02.
    const client = record('2008-09-02');
    expect(requiredConsents(client, ['home'], '2026-09-01')).toEqual([
      'home_visit',
      'minor_participation',
      'participation',
    ]);
    expect(requiredConsents(client, ['home'], '2026-09-02')).toEqual([
      'home_visit',
      'participation',
    ]);
  });
});
