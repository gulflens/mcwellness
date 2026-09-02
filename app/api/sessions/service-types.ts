import type { Hono } from 'hono';
import { hasRole, isCredentialValidOn, isoDateIn } from '@domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import { ServiceTypesResponse, type ServiceTypeOption } from './schema';

/**
 * GET /api/sessions/service-types: the service types the caller may run a
 * session for today — the check-in screen's (pull request 24) own picker,
 * offering only what this practitioner is actually credentialed and in-date
 * for, never the practice's whole catalogue (that is
 * app/api/billing/service-types.ts, a different door for a different
 * audience: every active service, for the owner and admin building a price
 * list).
 *
 * Reads no table directly for the credential check: the actor's own
 * capabilities (app.resolve_actor, db/migrations/095_actor.sql) already come
 * back from the request-context middleware scoped to this practitioner's own
 * active credentials, exactly what domain/shared/actor.ts's canActor reads
 * for the 'session.execute' action — this route asks the same question,
 * canExecuteSession valid today, over every service type rather than one.
 * service_type itself is then read under ordinary row security, tenant-scoped
 * by app.current_tenant_id() and narrowed to just those ids: it carries no
 * personal data, so nothing here is audited, matching
 * app/api/billing/service-types.ts's own read of the same table.
 */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type ServiceTypeRow = { id: string; code: string; name: string; name_ar: string | null };

const SQL =
  'select id, code, name, name_ar from service_type ' +
  'where tenant_id = app.current_tenant_id() and id = any($1) order by name';

export function mountServiceTypes(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/sessions/service-types', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');

    // The booking role, not merely a credential: the same floor
    // canCheckIn's own 'session.execute' gate stands on
    // (domain/shared/actor.ts), so a role that could never run a session
    // (finance, a client contact) is refused before its capabilities —
    // empty or not — are even consulted.
    if (!hasRole(actor, 'practitioner', 'lead_practitioner')) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const today = isoDateIn(now(), PRACTICE_TIME_ZONE);
    const serviceTypeIds = [
      ...new Set(
        actor.capabilities
          .filter(
            (capability) => capability.canExecuteSession && isCredentialValidOn(capability, today),
          )
          .map((capability) => capability.serviceTypeId),
      ),
    ];

    const rows =
      serviceTypeIds.length === 0
        ? []
        : (await c.get('db').query<ServiceTypeRow>(SQL, [serviceTypeIds])).rows;
    const serviceTypes: ServiceTypeOption[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.name_ar,
    }));
    return c.json(ServiceTypesResponse.parse({ serviceTypes }));
  });
}
