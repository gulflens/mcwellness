import type { Hono } from 'hono';
import type { ApiEnv } from '../_middleware/request-context';
import { mountPortalAccess, type PortalAccessOptions } from './access';
import { mountPortalAgreements } from './agreements';
import { mountPortalFamily } from './family';
import { mountPortalHome } from './home';
import { mountPortalMoney } from './money';
import { mountPortalReports } from './reports';
import { mountPortalVisits } from './visits';

export { mountPortalDoor, type PortalDoorOptions } from './door';
export { authAdminFromEnv, fakeAuthAdmin, type AuthAdminProvider } from './auth-admin';

/**
 * Every portal route that needs a session (docs/SPEC/client-portal.md section
 * 7). `app/api/create-api.ts` calls this once, after the authentication fence,
 * so the routes are reachable in the served app; the door is the exception and
 * is mounted before the fence by `mountPortalDoor`.
 *
 * The order matters in one place only: the office's `/api/portal/requests`
 * sits beside the household's `POST /api/portal/requests`, which are different
 * methods on one path and never confuse Hono's router. Everything else is
 * distinct.
 *
 * `options` carries the two things the office's invite route needs from the
 * deployment rather than from the request: where this app answers, and which
 * environment it is (`app/api/portal/access.ts`).
 */
export function mountPortal(
  api: Hono<ApiEnv>,
  now: () => Date = () => new Date(),
  options: PortalAccessOptions = {},
): void {
  mountPortalHome(api, now);
  mountPortalVisits(api, now);
  mountPortalMoney(api, now);
  mountPortalFamily(api, now);
  mountPortalAgreements(api, now);
  // The household's sixth screen (docs/SPEC/reports-v1.md section 7.3),
  // specified by the reports piece and mounted here with its siblings.
  mountPortalReports(api, now);
  // The practice's own side of the same module: household access and the asks.
  mountPortalAccess(api, now, options);
}
