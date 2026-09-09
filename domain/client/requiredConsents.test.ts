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
  it('always requires the health-data consent, whatever the delivery', () => {
    // Every client is trained on their own brain activity, so there is no
    // shape of engagement where the practice does not hold health data.
    for (const modes of [[], ['home'], ['studio'], ['remote']] as const) {
      expect(requiredConsents(record('1990-01-01'), modes, '2026-09-02')).toContain('health_data');
    }
  });

  it('always requires participation', () => {
    expect(requiredConsents(record('1990-01-01'), [], '2026-09-02')).toEqual([
      'health_data',
      'participation',
    ]);
  });

  it('adds home_visit only when delivery includes home', () => {
    expect(requiredConsents(record('1990-01-01'), ['remote'], '2026-09-02')).toEqual([
      'health_data',
      'participation',
    ]);
    expect(requiredConsents(record('1990-01-01'), ['home'], '2026-09-02')).toEqual([
      'health_data',
      'home_visit',
      'participation',
    ]);
    expect(requiredConsents(record('1990-01-01'), ['home', 'remote'], '2026-09-02')).toEqual([
      'health_data',
      'home_visit',
      'participation',
    ]);
  });

  it('adds minor_participation only while the client is a minor on atDate', () => {
    expect(requiredConsents(record('2010-01-01'), ['home'], '2026-09-02')).toEqual([
      'health_data',
      'home_visit',
      'minor_participation',
      'participation',
    ]);
  });

  it('never requires minor_participation when the date of birth is not yet known', () => {
    expect(requiredConsents(record(null), ['home'], '2026-09-02')).toEqual([
      'health_data',
      'home_visit',
      'participation',
    ]);
  });

  it('drops minor_participation the day the client turns eighteen', () => {
    // Born 2008-09-02: still seventeen on 2026-09-01, eighteen on 2026-09-02.
    const client = record('2008-09-02');
    expect(requiredConsents(client, ['home'], '2026-09-01')).toEqual([
      'health_data',
      'home_visit',
      'minor_participation',
      'participation',
    ]);
    expect(requiredConsents(client, ['home'], '2026-09-02')).toEqual([
      'health_data',
      'home_visit',
      'participation',
    ]);
  });
});
