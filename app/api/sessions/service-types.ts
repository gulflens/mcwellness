import type { Hono } from 'hono';
import { hasRole, isCredentialValidOn, isoDateIn } from '@domain/shared';
import type { ApiEnv } from '../_middleware/request-context';
import {
  ServiceTypesResponse,
  type ChecklistItem,
  type RatingQuestion,
  type ServiceTypeOption,
} from './schema';

/**
 * GET /api/sessions/service-types: the service types the caller may run a
 * session for today, and what each of them asks the practitioner — the
 * check-in screen's picker and the session runner's own pre-flight and
 * rating questions, in one read.
 *
 * Only what this practitioner is actually credentialed and in-date for,
 * never the practice's whole catalogue (that is
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
 * service_type itself is then read under ordinary row security,
 * tenant-scoped by app.current_tenant_id() and narrowed to just those ids,
 * and to status = 'active' — a retired service type never appears here,
 * matching app/api/billing/service-types.ts's own filter and checkin.ts's own
 * service_type lookup. It carries no personal data, so nothing here is
 * audited.
 */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

type ServiceTypeRow = {
  id: string;
  code: string;
  name: string;
  name_ar: string | null;
  preflight_checklist: unknown;
  rating_questions: unknown;
};

/**
 * `to_jsonb(st) -> 'column'` rather than `st.column`, on purpose and only
 * for these two.
 *
 * `service_type.preflight_checklist` and `service_type.rating_questions` are
 * the trunk's columns, landing in shared-zone round 14 (both `jsonb not null
 * default '[]'`, each an array of `{ key, label_en, label_ar }`, the second
 * also carrying `min` and `max`). This stream may not add them in a
 * migration of its own — they belong to `service_type`, which is core — so
 * until that round merges, a database built from the migrations on `main`
 * does not have them.
 *
 * Naming a column that does not exist is a hard error at parse time, which
 * would take the whole route down. Asking the row-as-jsonb for a key it may
 * not have is not: an absent key is a plain SQL null, so this same statement
 * runs correctly against a database with the columns and one without, and
 * the screen degrades to an empty checklist rather than a failure. Once
 * round 14 has merged, this can become an ordinary column reference; the
 * shape it parses into does not change.
 */
const SQL =
  'select id, code, name, name_ar, ' +
  "to_jsonb(st) -> 'preflight_checklist' as preflight_checklist, " +
  "to_jsonb(st) -> 'rating_questions' as rating_questions " +
  'from service_type st ' +
  "where tenant_id = app.current_tenant_id() and status = 'active' and id = any($1) " +
  'order by name';

type LabelledRow = { key?: unknown; label_en?: unknown; label_ar?: unknown };

/** The stored `{ key, label_en, label_ar }` shape, read defensively: settings a person edits. */
function readChecklist(value: unknown): ChecklistItem[] {
  if (!Array.isArray(value)) return [];
  const items: ChecklistItem[] = [];
  for (const entry of value) {
    const row = entry as LabelledRow;
    if (typeof row?.key !== 'string' || row.key.length === 0) continue;
    items.push({
      key: row.key,
      labelEn: typeof row.label_en === 'string' ? row.label_en : row.key,
      labelAr: typeof row.label_ar === 'string' ? row.label_ar : '',
    });
  }
  return items;
}

/** The same, plus the slider's ends. A question with no range at all is a 0-10 one. */
function readQuestions(value: unknown): RatingQuestion[] {
  if (!Array.isArray(value)) return [];
  return readChecklist(value).map((item, index) => {
    const row = (value[index] ?? {}) as { min?: unknown; max?: unknown };
    return {
      ...item,
      min: Number.isInteger(row.min) ? (row.min as number) : 0,
      max: Number.isInteger(row.max) ? (row.max as number) : 10,
    };
  });
}

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
      preflightChecklist: readChecklist(row.preflight_checklist),
      ratingQuestions: readQuestions(row.rating_questions),
    }));
    return c.json(ServiceTypesResponse.parse({ serviceTypes }));
  });
}
