import { describe, expect, it } from 'vitest';
import { refusalsForRecording, type AssessmentContext } from './gate';

/**
 * The reasons a recording is refused (docs/SPEC/assessment.md section 7.2).
 *
 * The facts come from `app.assessment_context` in the database; what they add
 * up to is decided here, once, so the record route and the correction route
 * cannot drift apart. These are the branches, each on its own.
 */

const ADULT: AssessmentContext = {
  clientFound: true,
  visible: true,
  practitionerId: '0000000f-0000-4000-8000-000000000001',
  credentialOk: true,
  hasDateOfBirth: true,
  isMinor: false,
  activeConsentPurposes: ['participation', 'home_visit'],
};

const context = (overrides: Partial<AssessmentContext> = {}): AssessmentContext => ({
  ...ADULT,
  ...overrides,
});

describe('what refuses a recording', () => {
  it('refuses nothing when the record, the person and the household all allow it', () => {
    expect(refusalsForRecording(context(), 'home')).toEqual([]);
  });

  it('says only that the record is not one of this practice’s', () => {
    // Nothing else is said about a client this caller has not been shown to
    // reach: the other columns are blank by then anyway (migration 500).
    expect(refusalsForRecording(context({ clientFound: false }), 'home')).toEqual([
      'client_not_found',
    ]);
  });

  it('says only that the record is not on their schedule', () => {
    expect(refusalsForRecording(context({ visible: false }), 'home')).toEqual(['not_visible']);
  });

  it('gives every reason at once rather than one at a time', () => {
    // A practitioner told their certification has lapsed, and then, on fixing
    // it, told the consent is missing, has been refused twice for one attempt.
    expect(
      refusalsForRecording(
        context({ credentialOk: false, activeConsentPurposes: ['home_visit'] }),
        'home',
      ),
    ).toEqual(['credential_invalid', 'consent_missing_participation']);
  });

  it('refuses a client with no date of birth rather than treating them as an adult', () => {
    // Without a date of birth the app cannot tell whether a guardian must
    // agree, and assuming an adult decides that question the dangerous way
    // round. canCheckIn fails closed here too, and in this order.
    expect(refusalsForRecording(context({ hasDateOfBirth: false }), 'home')).toEqual([
      'date_of_birth_unknown',
    ]);
  });

  it('asks for the guardian’s own agreement for a minor, and not otherwise', () => {
    expect(refusalsForRecording(context({ isMinor: true }), 'home')).toEqual([
      'consent_missing_minor_participation',
    ]);
    expect(
      refusalsForRecording(
        context({
          isMinor: true,
          activeConsentPurposes: ['participation', 'minor_participation', 'home_visit'],
        }),
        'home',
      ),
    ).toEqual([]);
  });

  it('does not ask for a guardian’s agreement it cannot know is needed', () => {
    // No date of birth and no guardian consent: one refusal, the one that can
    // be acted on. Naming both would ask the practice to chase an agreement
    // that may not be needed at all.
    expect(
      refusalsForRecording(context({ hasDateOfBirth: false, isMinor: false }), 'home'),
    ).toEqual(['date_of_birth_unknown']);
  });

  it('refuses a recording with no person to attribute it to', () => {
    expect(refusalsForRecording(context({ practitionerId: null }), 'home')).toEqual([
      'no_practitioner_row',
    ]);
  });

  it('asks for the home-visit agreement where the recording happened at home', () => {
    expect(
      refusalsForRecording(context({ activeConsentPurposes: ['participation'] }), 'home'),
    ).toEqual(['consent_missing_home_visit']);
  });
});
