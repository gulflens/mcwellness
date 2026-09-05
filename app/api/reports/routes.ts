import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountReportDeliver } from './deliver';
import { mountReportDraft } from './draft';
import { mountReportGet } from './get';
import { mountReportIssue } from './issue';
import { mountReportList } from './list';
import { mountReportSupersede } from './supersede';

/**
 * Mounts every reports route (docs/SPEC/reports-v1.md section 7.1). Called
 * from `app/api/create-api.ts` after the authentication fence and with no raw
 * body: a report is rendered by the server, so nothing here ever reads bytes a
 * caller uploaded.
 *
 * The order matters in one place: `/api/reports/schema` and
 * `/api/reports/gather` are fixed paths that would otherwise be read as
 * `/api/reports/:id`, so the list module — which mounts both — goes first.
 *
 * The database tests also mount this themselves, on the api that `createApi`
 * returns, so they do not depend on that wiring either;
 * `tests/db/route-mounts.test.ts` is what proves the wiring itself.
 */
export function mountReports(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  mountReportList(api, now);
  mountReportDraft(api, now);
  mountReportIssue(api, now);
  mountReportSupersede(api, now);
  mountReportDeliver(api, now);
  mountReportGet(api, now);
}
