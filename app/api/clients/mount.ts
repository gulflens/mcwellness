import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountConsentWording } from './consent-wording';
import { mountConsents } from './consents';
import { mountContacts } from './contacts';
import { mountDocuments } from './documents';
import { mountErasureRequests } from './erasure';
import { mountGoalCategories } from './goal-categories';
import { mountGoals } from './goals';
import { mountLocations } from './locations';
import { mountClientRecordCore } from './record';

/**
 * Every client-record route this worktree adds: the record itself, contacts,
 * locations, goals, consents, documents and erasure requests
 * (docs/SPEC/client-record.md; "Client Record Plan" PR 2). `GET /api/clients`
 * (list) and `GET /api/clients/:id/timeline` are mounted elsewhere
 * (app/api/clients/list.ts, app/api/audit/timeline.ts) and untouched here.
 *
 * app/api/create-api.ts calls this once (CR-03 of
 * docs/CHANGE-REQUESTS/client-record-01.md, applied in pull request 31), so
 * every route below is reachable in the served app; a test that wants them in
 * isolation mounts them itself.
 */
export function mountClientRecord(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  // Registered before the /:id routes below: a static path (goal-categories
  // is not a client) and a param one never actually conflict in Hono's
  // router, but there is no reason to rely on that when the safe order costs
  // nothing.
  mountGoalCategories(api);
  // /api/clients/consent-wording is a static path beside /api/clients/:id, and
  // registered before it for the same reason goal-categories is: Hono's router
  // never actually confuses the two, and the safe order costs nothing.
  mountConsentWording(api);
  mountClientRecordCore(api, now);
  mountContacts(api, now);
  mountLocations(api, now);
  mountGoals(api);
  mountConsents(api, now);
  mountDocuments(api, now);
  mountErasureRequests(api);
}
