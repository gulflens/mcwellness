import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountReportDeliver } from './deliver';
import { mountReportDraft } from './draft';
import { mountReportExternal } from './external';
import { mountReportFigures } from './qeeg/figures';
import { mountReportPastRecords } from './qeeg/pastRecord';
import { mountReportPrefill } from './qeeg/prefill';
import { mountReportTwin } from './qeeg/twin';
import { mountReportGet } from './get';
import { mountReportIssue } from './issue';
import { mountReportList } from './list';
import { mountReportPreview } from './preview';
import { mountReportSupersede } from './supersede';
import { mountReportWithdraw } from './withdraw';

/**
 * Mounts every reports route (docs/SPEC/reports-v1.md section 7.1). Called
 * from `app/api/create-api.ts` after the authentication fence. Two doors read
 * bytes a caller uploaded: a brain-map draft's pictures
 * (`qeeg/figures.ts`, docs/SPEC/reports-qeeg.md section 9), and an uploaded
 * report's PDF (`external.ts`, docs/SPEC/reports-v1.md section 12), which
 * `create-api.ts` exempts from `jsonOnly` and gives a cap and a clock of
 * their own (docs/CHANGE-REQUESTS/reports-02.md, request 3). Every other
 * route here takes JSON, because a report is rendered by the server.
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
  // A fixed path, `/api/reports/qeeg/import`, beside the `:id` ones: mounted
  // before them, as the list's fixed paths are.
  mountReportPastRecords(api, now);
  // `/api/reports/qeeg/prefill`, a fixed path, likewise before the `:id` ones.
  mountReportPrefill(api, now);
  // `/api/reports/external`, a fixed path, likewise before the `:id` ones.
  mountReportExternal(api, now);
  mountReportDraft(api, now);
  mountReportIssue(api, now);
  mountReportPreview(api, now);
  mountReportSupersede(api, now);
  mountReportWithdraw(api, now);
  mountReportDeliver(api, now);
  mountReportFigures(api, now);
  mountReportTwin(api, now);
  mountReportGet(api, now);
}
