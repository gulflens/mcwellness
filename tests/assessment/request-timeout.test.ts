import { describe, expect, it } from 'vitest';
import { ASSESSMENT_FILE_LIMIT_BYTES as CONSOLE_LIMIT_BYTES } from '../../app/api/assessments/schema';
import {
  ASSESSMENT_FILE_LIMIT_BYTES,
  ASSESSMENT_FILE_TIMEOUT_MS,
  BODY_LIMIT_BYTES,
  LOGO_BODY_LIMIT_BYTES,
  REQUEST_TIMEOUT_MS,
  requestTimeoutMs,
} from '../../app/api/create-api';

/**
 * The one door with a clock of its own (docs/SPEC/assessment.md section 7.1,
 * docs/CHANGE-REQUESTS/assessment-01.md item 2).
 *
 * `timeout` races the whole handler, the body read included, so the ten
 * seconds every other path keeps would kill a 64 MB export on any ordinary
 * link before it finished arriving — the cap the door exists for could never
 * be reached. The budget is longer for that one method on that one path and
 * for nothing else, which is what these assertions are for: the widening must
 * stay exactly as narrow as the body cap beside it.
 *
 * The cap is 64 MB from 2026-09-06, on the founder's equipment answer: the
 * practice's own raw recordings are 22 to 33 MB apiece and a longer recording
 * is bigger (docs/CHANGE-REQUESTS/assessment-02.md item 1).
 */

const FILE_PATH = '/api/assessments/00000000-0000-4000-8000-000000000001/file';

describe('the body cap', () => {
  it('gives the export’s own door sixty-four megabytes', () => {
    expect(ASSESSMENT_FILE_LIMIT_BYTES).toBe(64 * 1024 * 1024);
  });

  it('says the same number to the browser, which refuses before it sends', () => {
    // Two constants because one module is the server's and pulls in Node while
    // the other is read by the console. They must not drift.
    expect(CONSOLE_LIMIT_BYTES).toBe(ASSESSMENT_FILE_LIMIT_BYTES);
  });

  it('leaves every other envelope exactly where it was', () => {
    expect(BODY_LIMIT_BYTES).toBe(64 * 1024);
    // The logo's is the base64 envelope's own arithmetic and is not a number
    // this door has any business moving; what is asserted is that it is still
    // small, and nowhere near the one that grew.
    expect(LOGO_BODY_LIMIT_BYTES).toBeLessThan(BODY_LIMIT_BYTES * 16);
  });
});

describe('the request budget', () => {
  it('gives the export’s own door long enough for sixty-four megabytes', () => {
    expect(requestTimeoutMs('PUT', FILE_PATH)).toBe(ASSESSMENT_FILE_TIMEOUT_MS);
    // The arithmetic the comment beside the constant sets out: a link that
    // carries the whole cap inside the budget needs a little under 1.3 Mbit/s,
    // which an ordinary fixed or mobile link in the Emirates clears.
    const bitsPerSecond = (ASSESSMENT_FILE_LIMIT_BYTES * 8) / (ASSESSMENT_FILE_TIMEOUT_MS / 1000);
    expect(bitsPerSecond).toBeLessThan(1_500_000);
    // And it is a budget rather than an exemption: a request with no clock on
    // it is a transaction held open for as long as somebody dribbles bytes.
    expect(ASSESSMENT_FILE_TIMEOUT_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  it('keeps the ordinary budget on every other method at that same address', () => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      expect(requestTimeoutMs(method, FILE_PATH)).toBe(REQUEST_TIMEOUT_MS);
    }
  });

  it('keeps the ordinary budget on every other path', () => {
    const paths = [
      '/api/me',
      '/api/health',
      '/api/assessments',
      '/api/assessments/compare',
      '/api/assessments/00000000-0000-4000-8000-000000000001',
      '/api/assessments/00000000-0000-4000-8000-000000000001/supersede',
      '/api/assessments/file/00000000-0000-4000-8000-000000000002/link',
      '/api/clients/00000000-0000-4000-8000-000000000003/assessments',
      // The setup photograph's own door until 2026-09-09; the practice takes
      // no photographs, so this is now an ordinary path like any other.
      '/api/sessions/00000000-0000-4000-8000-000000000004/photo',
      '/api/practice/logo',
      '/api/billing/documents',
      // The shape is anchored at both ends: a path that merely carries the
      // door's name inside it is not the door.
      '/api/assessments/00000000-0000-4000-8000-000000000001/file/anything',
      '/api/proxy/api/assessments/00000000-0000-4000-8000-000000000001/file',
    ];
    for (const path of paths) {
      expect(requestTimeoutMs('PUT', path), path).toBe(REQUEST_TIMEOUT_MS);
      expect(requestTimeoutMs('GET', path), path).toBe(REQUEST_TIMEOUT_MS);
    }
  });
});
