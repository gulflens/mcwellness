import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountConsents } from './consents';
import { mountContacts } from './contacts';
import { mountErasureRequests } from './erasure';
import { mountGoals } from './goals';
import { mountLocations } from './locations';
import { mountClientRecordCore } from './record';

/**
 * Every client-record route this worktree's second pull request adds: the
 * record itself, contacts, locations, goals, consents and erasure requests
 * (docs/SPEC/client-record.md; "Client Record Plan" PR 2). `GET /api/clients`
 * (list) and `GET /api/clients/:id/timeline` are mounted elsewhere
 * (app/api/clients/list.ts, app/api/audit/timeline.ts) and untouched here.
 *
 * Not wired into app/api/create-api.ts yet: that file is the shared zone
 * (docs/SPEC/OWNERSHIP.md) and this worktree does not edit it.
 * docs/CHANGE-REQUESTS/client-record-01.md asks the trunk to add the one
 * `mountClientRecord(api, deps.now)` call these routes need to be reachable
 * outside a test that mounts them itself.
 */
export function mountClientRecord(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountClientRecordCore(api, now);
  mountContacts(api, now);
  mountLocations(api, now);
  mountGoals(api);
  mountConsents(api, now);
  mountErasureRequests(api);
}
