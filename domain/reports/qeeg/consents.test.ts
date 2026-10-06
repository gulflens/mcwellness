import { describe, expect, it } from 'vitest';
import { brainMapConsentRefusals } from './consents';

describe('brainMapConsentRefusals', () => {
  it('asks nothing of an adult who agreed to take part and to the practice holding brain data', () => {
    expect(
      brainMapConsentRefusals({ active: ['participation', 'health_data'], isMinor: false }),
    ).toEqual([]);
  });

  it('refuses without participation, and without health_data, naming each', () => {
    expect(brainMapConsentRefusals({ active: [], isMinor: false })).toEqual([
      'consent_missing_participation',
      'consent_missing_health_data',
    ]);
    expect(brainMapConsentRefusals({ active: ['participation'], isMinor: false })).toEqual([
      'consent_missing_health_data',
    ]);
  });

  it('asks a guardian’s agreement for a minor', () => {
    expect(
      brainMapConsentRefusals({ active: ['participation', 'health_data'], isMinor: true }),
    ).toEqual(['consent_missing_minor_participation']);
    expect(
      brainMapConsentRefusals({
        active: ['participation', 'health_data', 'minor_participation'],
        isMinor: true,
      }),
    ).toEqual([]);
  });

  it('fails closed when the date of birth is unknown, asking the guardian’s agreement', () => {
    expect(
      brainMapConsentRefusals({ active: ['participation', 'health_data'], isMinor: null }),
    ).toEqual(['consent_missing_minor_participation']);
  });
});
