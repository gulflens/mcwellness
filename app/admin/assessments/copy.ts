import type { Band, RefusalReason, Unit } from '@domain/assessment';
import type { AssessmentFileRole } from '../../api/assessments/schema';

/**
 * The words the Assessments tab says (docs/SPEC/assessment.md sections 3.2 and
 * 3.3). Kept apart from the screens so the one sentence that may never drift
 * can be read on its own.
 */

/**
 * The fixed sentence, in English and Arabic, that sits on the comparison and
 * on anything printed from it (section 3.3).
 *
 * **The second half is the consent's own wording**, word for word —
 * `docs/CONSENT/participation.en.md`: "It shows patterns of activity. It is
 * not a diagnosis." and its Arabic twin's "وهي ليست تشخيصاً" — so the screen
 * and the agreement every household signs can never come apart. Nothing on
 * this tab, in an export or in a report may say anything stronger.
 */
export const NOT_A_DIAGNOSIS = {
  en: 'This is a comparison of measurements taken on different days. It is not a diagnosis.',
  ar: 'هذه مقارنة بين قياسات أُخذت في أيام مختلفة. وهي ليست تشخيصاً.',
} as const;

/** The five bands, named for a reader. The hue is the token's, never a word's. */
export const BAND_LABELS: Record<Band, string> = {
  delta: 'Delta',
  theta: 'Theta',
  alpha: 'Alpha',
  beta: 'Beta',
  gamma: 'Gamma',
};

/**
 * What a figure is in. Written out rather than abbreviated, because a person
 * reading a table months later should not have to remember what a symbol
 * meant.
 */
export const UNIT_LABELS: Record<Unit, string> = {
  uV2: 'Microvolts squared',
  percent: 'Per cent of the total',
  ratio: 'Ratio',
  sd: "Standard deviations from the software's own reference",
  points: 'Points',
};

/** The same, short enough for a column head. */
export const UNIT_SHORT: Record<Unit, string> = {
  uV2: 'µV²',
  percent: '%',
  ratio: 'ratio',
  sd: 'SD',
  points: 'points',
};

/**
 * Why a payload was refused, said plainly. The field the API names is shown
 * beside it, so the person is told which one rather than told to look.
 */
export const REFUSAL_MESSAGES: Record<RefusalReason | string, string> = {
  unknown_instrument: 'This app has no shape declared for that instrument.',
  unknown_instrument_version: 'This app does not know that edition of the instrument.',
  not_an_object: 'That is not a set of figures.',
  wrong_kind: 'Those figures are not the kind this instrument records.',
  missing: 'Fill this in.',
  not_a_number: 'This has to be a number.',
  not_finite: 'This has to be a number.',
  not_an_integer: 'This has to be a whole number.',
  out_of_scale: 'This is outside the scale the question is answered on.',
  missing_unit: 'Say what this figure is in.',
  unknown_unit: 'That is not a unit this app records.',
  unknown_site: 'That is not a site on the ten-twenty map.',
  unknown_band: 'That is not one of the five bands.',
  unknown_condition: 'Say whether the eyes were open or closed.',
  duplicate_figure: 'That site and band already have a figure.',
  unknown_question: 'That is not a question this form asks.',
  missing_question: 'Answer every question.',
  total_disagrees: 'The total does not follow from the answers.',
  maximum_disagrees: 'The maximum is not the one this form is scored out of.',
  unknown_field: 'This app does not record that.',
  interpretation_not_stored:
    'A measurement carries figures and no words. What it means goes in a signed report.',
};

/** Why a recording was refused by a gate, said plainly (section 7.2). */
export const GATE_MESSAGES: Record<string, string> = {
  client_not_found: 'That record is not one of this practice’s.',
  not_visible: 'That record is not on your schedule.',
  no_practitioner_row: 'You are not set up as a practitioner of this practice.',
  credential_invalid: 'Your certification for this service is not valid today.',
  consent_missing_participation: 'This household has no active agreement to take part.',
  date_of_birth_unknown:
    'No date of birth is recorded, so this app cannot tell whether a guardian must agree. ' +
    'Ask the practice to add it.',
  consent_missing_minor_participation:
    'A guardian has not agreed on this child’s behalf. That agreement is its own.',
  consent_missing_home_visit: 'This household has not agreed to a home visit.',
  not_your_measurement:
    'Only the practitioner who took this, or the lead practitioner, may correct it.',
  already_superseded: 'A newer version of this measurement already stands.',
  reason_required: 'Say why this is being corrected. The record keeps the reason.',
  reason_too_long: 'That reason is longer than the record holds.',
};

/**
 * What a file filed against a measurement is. One brain map produces several —
 * the recording the equipment wrote, and the software's own report — so the
 * role is chosen when the file is attached and said when it is listed.
 */
export const FILE_ROLE_LABELS: Record<AssessmentFileRole, string> = {
  raw: 'The recording',
  vendor_report: 'The software’s report',
};

/** Attaching an export, and opening one. Said before anything is sent. */
export const ATTACH_MESSAGES = {
  empty: 'That file has nothing in it.',
  too_large: 'That file is larger than this door takes. Sixty-four megabytes is the limit.',
  failed: 'That export could not be filed. Try again.',
  store_unavailable: 'The document store cannot be reached, so nothing was filed.',
  link_failed: 'That file did not open.',
};

/**
 * Why the door refused a file, by the word it answered with — its `code` where
 * it names one and its `error` otherwise, because a refusal made before the
 * route is reached (the body cap, the media type) carries only the latter.
 */
export const ATTACH_REFUSALS: Record<string, string> = {
  not_a_pdf: 'That is not a PDF. A report is the software’s own PDF.',
  not_a_recording:
    'That is not a recording this door takes. A recording is an EDF file or the amplifier ' +
    'software’s own.',
  unsupported_media_type:
    'That is not a file this door takes. It takes the software’s PDF, an EDF recording, or the ' +
    'amplifier software’s own recording.',
  payload_too_large: ATTACH_MESSAGES.too_large,
  empty_body: ATTACH_MESSAGES.empty,
  digest_mismatch: 'The file changed on the way. Choose it again.',
  digest_missing: 'The file changed on the way. Choose it again.',
  storage_unavailable: ATTACH_MESSAGES.store_unavailable,
  document_exists: 'Something is already filed under that name.',
  forbidden: 'Filing an export against this measurement is not yours to do.',
  not_found: 'That measurement is no longer there.',
};

/** Why a comparison could not be made. */
export const COMPARISON_MESSAGES: Record<string, string> = {
  same_assessment: 'Choose two different measurements.',
  different_clients: 'Those two measurements belong to different people.',
  different_instruments: 'Those two measurements are of different instruments.',
  unit_mismatch: 'Those two recordings are not in the same units, so there is nothing to subtract.',
  maximum_mismatch: 'Those two totals are scored out of different maximums.',
  out_of_order: 'Choose an earlier measurement and a later one.',
};
