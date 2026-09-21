import { isLocked, type Role } from '@domain/shared';
import type { Db } from '../_middleware/request-context';
import type { TeamMember } from './schema';

/**
 * How Settings › Team reads the practice's own people: the list, and one
 * colleague read as the actor. Split out of `./routes.ts` in round 58,
 * 2026-09-21, when the file passed 550 lines; the routes themselves are in
 * `./routes.ts`, `./profile.ts` and `./roles.ts`, and every one of them reads
 * its target through this file so a rule is never asked of something a caller
 * sent.
 *
 * **Two reads, on purpose.** `readTarget` answers the whole person, for the two
 * routes that show or save a profile and that write a `read` row for doing so.
 * `readTargetRoles` answers who they are and what they hold and nothing else,
 * for the three that only need to decide — suspending, and a role on or off.
 * None of those three shows a name, an address or a telephone number to
 * anybody, so none of them reads one (round 58's review, item M6).
 */

export type Row = {
  id: string;
  display_name: string;
  email: string | null;
  status: 'active' | 'suspended' | 'archived';
  roles: string[];
  job_title: string | null;
};

/**
 * The list. `job_title` is joined for an owner and is not asked for at all
 * otherwise: row security on `staff_profile` would answer null for an admin
 * anyway, and a query that never asks is the second reason it can never
 * answer.
 */
export function membersSql(forOwner: boolean): string {
  return (
    'select u.id, u.display_name, u.email, u.status::text as status, ' +
    (forOwner ? 'p.job_title, ' : 'null::text as job_title, ') +
    "coalesce(array_agg(r.role::text order by r.role) filter (where r.role is not null), '{}') as roles " +
    'from app_user u left join user_role r on r.user_id = u.id and r.tenant_id = u.tenant_id ' +
    (forOwner
      ? 'left join staff_profile p on p.user_id = u.id and p.tenant_id = u.tenant_id '
      : '') +
    'where u.tenant_id = app.current_tenant_id() ' +
    'group by u.id' +
    (forOwner ? ', p.job_title ' : ' ') +
    // A household contact is not staff, and lives in Settings › Portal.
    "having bool_or(r.role <> 'client_contact') " +
    'order by u.display_name, u.id'
  );
}

export function toMember(row: Row, actorUserId: string): TeamMember {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    status: row.status,
    roles: row.roles,
    isYou: row.id === actorUserId,
    locked: isLocked(row.roles as Role[]),
    jobTitle: row.job_title,
  };
}

export type Target = {
  id: string;
  auth_id: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  preferred_locale: 'en' | 'ar';
  status: Row['status'];
  roles: Role[];
};

/** Who a colleague is, and who they are not: staff of this practice, or nobody. */
const STAFF_CLAUSES =
  'from app_user u where u.id = $1 and u.tenant_id = app.current_tenant_id() ' +
  "and exists (select 1 from user_role r where r.user_id = u.id and r.role <> 'client_contact')";

const ROLES_COLUMN =
  '(select array_agg(r.role::text order by r.role) from user_role r ' +
  'where r.user_id = u.id and r.tenant_id = u.tenant_id) as roles ';

/** One colleague, whole, read once as the actor. */
const TARGET_SQL =
  'select u.id, u.auth_id, u.display_name, u.email, u.phone, u.preferred_locale::text as preferred_locale, ' +
  'u.status::text as status, ' +
  ROLES_COLUMN +
  STAFF_CLAUSES;

export async function readTarget(db: Db, id: string): Promise<Target | null> {
  const { rows } = await db.query<Target>(TARGET_SQL, [id]);
  return rows[0] ?? null;
}

export type TargetRoles = { id: string; status: Row['status']; roles: Role[] };

/** The same colleague, as little of them as a decision needs. */
const TARGET_ROLES_SQL = 'select u.id, u.status::text as status, ' + ROLES_COLUMN + STAFF_CLAUSES;

export async function readTargetRoles(db: Db, id: string): Promise<TargetRoles | null> {
  const { rows } = await db.query<TargetRoles>(TARGET_ROLES_SQL, [id]);
  return rows[0] ?? null;
}
