import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The practice runs its brain mapping and neurofeedback on the vendor's own
 * software. Round "readings-dormant" (13 September 2026) switched the app's
 * own reading capability off — behind `tenant.record_readings`, which ships
 * `false` — rather than deleting it, because the operator may want it back
 * without a redeploy (task-3-brief.md, section 3.3/3.4).
 *
 * **The defect this exists to prevent.** Dormant code renders for nobody
 * while the switch is off, which for this practice today is every visit.
 * A later tidy-up — "nothing imports this when the flag's off, let's delete
 * the dead branch" — would remove `SignalStep.tsx`, `SignalDots.tsx`, the
 * signal-quality and observation-flag domain functions, or the event shapes
 * they carry, and no screen and no failing render would say so, because
 * nothing renders them today. The switch would keep existing in Settings and
 * keep doing nothing when flipped. That is a switch for nothing, not a
 * dormant feature — and the only way to catch it before a client's home is
 * a test that runs on every commit and does not care whether the switch is
 * on.
 *
 * So this checks, statically, that each piece is still on disk, still wired
 * into a file that runs, and still exercised by a test that runs — whether
 * or not `record_readings` is true for anyone today.
 *
 * **What is not here.** `steps.ts` exports `stepsFor(recordReadings)`, a
 * declared step sequence, but `SessionRunner.tsx`'s navigation is hardcoded
 * `setStep` calls that consult only one element of it — whether `'signal'`
 * is present. This guard pins that one call (the group below named
 * "the switch's own plumbing"), because losing it silently reintroduces the
 * signal step for a practice that turned readings off, the exact shape of
 * defect this file exists to catch. It does not pin the rest of the declared
 * array against the runner's hardcoded steps: proving a data array and a
 * sequence of imperative calls always agree is a runner-behaviour question,
 * already exercised end to end by `tests/session/SessionRunner.test.tsx`'s
 * "is exactly the sequence it is today" tests, not a fact a lint guard can
 * check by reading text without re-implementing the runner.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Reads a repository file, or null if it is gone. Never throws: a deleted
 * file is exactly the fact a check here needs to report by name, not a crash
 * that stops every other check from reporting theirs.
 */
function read(path: string): string | null {
  try {
    return readFileSync(join(ROOT, path), 'utf8');
  } catch {
    return null;
  }
}

/** True when every one of `needles` is a substring of `content` (null content is never a match). */
function has(content: string | null, ...needles: string[]): boolean {
  return content !== null && needles.every((needle) => content.includes(needle));
}

type Check = { label: string; pass: boolean };

const checks: Check[] = [];
function check(label: string, pass: boolean): void {
  checks.push({ label, pass });
}

// --- The files themselves ---------------------------------------------
const SIGNAL_STEP = read('app/therapist/session/SignalStep.tsx');
const SIGNAL_DOTS = read('app/therapist/session/SignalDots.tsx');
const SCORE_SIGNAL_QUALITY = read('domain/session/scoreSignalQuality.ts');
const DERIVE_OBSERVATION_FLAG = read('domain/session/deriveObservationFlag.ts');
const EVENTS = read('domain/session/events.ts');
const RUN_STEP = read('app/therapist/session/RunStep.tsx');
const POST_STEP = read('app/therapist/session/PostStep.tsx');
const SESSION_RUNNER = read('app/therapist/session/SessionRunner.tsx');
const CLOSE_ROUTE = read('app/api/sessions/close.ts');

check('app/therapist/session/SignalStep.tsx still exists', SIGNAL_STEP !== null);
check('app/therapist/session/SignalDots.tsx still exists', SIGNAL_DOTS !== null);
check('domain/session/scoreSignalQuality.ts still exists', SCORE_SIGNAL_QUALITY !== null);
check('domain/session/deriveObservationFlag.ts still exists', DERIVE_OBSERVATION_FLAG !== null);

// --- Still wired into a file that runs, not an orphan nobody imports ----
check(
  "SessionRunner.tsx still imports SignalStep from './SignalStep'",
  has(SESSION_RUNNER, "from './SignalStep'"),
);
check(
  "SignalStep.tsx still imports SignalDots from './SignalDots'",
  has(SIGNAL_STEP, "from './SignalDots'"),
);
check(
  'SessionRunner.tsx still calls scoreSignalQuality(',
  has(SESSION_RUNNER, 'scoreSignalQuality('),
);
check(
  'app/api/sessions/close.ts still calls deriveObservationFlag(',
  has(CLOSE_ROUTE, 'deriveObservationFlag('),
);

// --- The reading (signal_checked) and telemetry_chunk event shapes ------
// "reading" here is the electrode-site reading a practitioner takes at
// setup — SignalCheckedPayload — named this way in task-3-brief.md and
// task-3-report.md, which use "reading" and "signal_checked" for the same
// shape interchangeably. telemetry_chunk is the per-minute (or
// end-of-session summary) reading taken during the run.
check(
  'events.ts still exports SignalCheckedPayload (the "reading" shape)',
  has(EVENTS, 'export const SignalCheckedPayload'),
);
check(
  'events.ts still exports TelemetryChunkPayload',
  has(EVENTS, 'export const TelemetryChunkPayload'),
);
check(
  'events.ts still maps the signal_checked kind to SignalCheckedPayload in the vocabulary table',
  /signal_checked:\s*SignalCheckedPayload/.test(EVENTS ?? ''),
);
check(
  'events.ts still maps the telemetry_chunk kind to TelemetryChunkPayload in the vocabulary table',
  /telemetry_chunk:\s*TelemetryChunkPayload/.test(EVENTS ?? ''),
);

// --- Still covered by a test that runs -----------------------------------
// SignalStep.tsx and SignalDots.tsx have no test file of their own; they are
// exercised through the runner's own integration test, which is a test file
// that runs all the same.
const RUNNER_TEST = read('tests/session/SessionRunner.test.tsx');
check(
  "SessionRunner.test.tsx still checks the signal ('Check the signal' / heading 'Signal')",
  has(RUNNER_TEST, "'Check the signal'") &&
    has(RUNNER_TEST, "findByRole('heading', { name: 'Signal' })"),
);
check(
  'SessionRunner.test.tsx still asserts the signal indicator SignalDots renders (role img, name /signal/i)',
  has(RUNNER_TEST, "getByRole('img', { name: /signal/i })"),
);

const SCORE_SIGNAL_QUALITY_TEST = read('domain/session/scoreSignalQuality.test.ts');
check(
  'domain/session/scoreSignalQuality.test.ts still exists and calls scoreSignalQuality(',
  has(SCORE_SIGNAL_QUALITY_TEST, 'scoreSignalQuality('),
);

const DERIVE_OBSERVATION_FLAG_TEST = read('domain/session/deriveObservationFlag.test.ts');
check(
  'domain/session/deriveObservationFlag.test.ts still exists and calls deriveObservationFlag(',
  has(DERIVE_OBSERVATION_FLAG_TEST, 'deriveObservationFlag('),
);

const EVENTS_TEST = read('domain/session/events.test.ts');
check(
  "events.test.ts still covers signal_checked (describe('signal_checked'",
  has(EVENTS_TEST, "describe('signal_checked'"),
);
check(
  "events.test.ts still covers telemetry_chunk (describe('telemetry_chunk'",
  has(EVENTS_TEST, "describe('telemetry_chunk'"),
);

// --- The two dormant sections inside living files ------------------------
// RunStep.tsx and PostStep.tsx are not dormant files — they are screens a
// readings-off visit still uses for everything else. Only one section of
// each is dormant, so what is checked here is that section's own markers:
// the mid-run reading toggle and its two sliders (RunStep), and the
// end-of-session summary reading and its two sliders (PostStep). A file
// existence check would prove nothing, since the file is never absent.
check("RunStep.tsx still renders the 'Record a reading' toggle", has(RUN_STEP, 'Record a reading'));
check('RunStep.tsx still renders the reading-reward slider', has(RUN_STEP, 'id="reading-reward"'));
check(
  'RunStep.tsx still renders the reading-artefact slider',
  has(RUN_STEP, 'id="reading-artefact"'),
);
check(
  'PostStep.tsx still takes and uses needsSummaryReading for the summary reading section',
  has(POST_STEP, 'needsSummaryReading'),
);
check(
  'PostStep.tsx still renders the summary-reward slider',
  has(POST_STEP, 'id="summary-reward"'),
);
check(
  'PostStep.tsx still renders the summary-artefact slider',
  has(POST_STEP, 'id="summary-artefact"'),
);

// --- The switch's own plumbing: the one place stepsFor is consulted -----
// See the file comment's "What is not here" for the scope of this one check.
check(
  "SessionRunner.tsx still asks stepsFor(recordReadings) whether 'signal' is in the sequence",
  has(SESSION_RUNNER, "stepsFor(recordReadings).includes('signal')"),
);

/**
 * Fails closed: this is the number of checks pushed above, written by hand.
 * A change to this file that left the list-building code accidentally
 * short-circuited (an early return, a loop that never iterates) would still
 * report zero offenders and pass, unless the count itself is pinned.
 */
const EXPECTED_CHECK_COUNT = 25;

describe('the dormant reading capability stays alive, not just switched off', () => {
  it('ran every check this guard is built from', () => {
    expect(checks.length).toBe(EXPECTED_CHECK_COUNT);
  });

  it('finds every guarded file, wiring and test coverage intact', () => {
    const offenders = checks.filter((c) => !c.pass).map((c) => c.label);
    expect(offenders).toEqual([]);
  });
});
