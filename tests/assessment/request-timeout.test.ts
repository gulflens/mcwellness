import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_FILE_LIMIT_BYTES,
  ASSESSMENT_FILE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  requestTimeoutMs,
} from '../../app/api/create-api';

/**
 * The one door with a clock of its own (docs/SPEC/assessment.md section 7.1,
 * docs/CHANGE-REQUESTS/assessment-01.md item 2).
 *
 * `timeout` races the whole handler, the body read included, so the ten
 * seconds every other path keeps would kill a 20 MB export on any ordinary
 * link before it finished arriving — the cap the door exists for could never
 * be reached. The budget is longer for that one method on that one path and
 * for nothing else, which is what these assertions are for: the widening must
 * stay exactly as narrow as the body cap beside it.
 */

const FILE_PATH = '/api/assessments/00000000-0000-4000-8000-000000000001/file';

describe('the request budget', () => {
  it('gives the export’s own door long enough for twenty megabytes', () => {
    expect(requestTimeoutMs('PUT', FILE_PATH)).toBe(ASSESSMENT_FILE_TIMEOUT_MS);
    // The arithmetic the comment beside the constant sets out: a link that
    // carries the whole cap inside the budget needs a little under 1.4 Mbit/s.
    const bitsPerSecond = (ASSESSMENT_FILE_LIMIT_BYTES * 8) / (ASSESSMENT_FILE_TIMEOUT_MS / 1000);
    expect(bitsPerSecond).toBeLessThan(2_000_000);
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
