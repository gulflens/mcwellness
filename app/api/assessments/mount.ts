import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountAssessmentFile } from './file';
import { mountAssessments as mountAssessmentRoutes } from './routes';

/**
 * Every route this stream adds (docs/SPEC/assessment.md section 7).
 * `app/api/create-api.ts` calls this once, so each of them is reachable in the
 * served app; a test that wants them in isolation mounts them itself.
 */
export function mountAssessments(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountAssessmentRoutes(api, now);
  mountAssessmentFile(api, now);
}
