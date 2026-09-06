import { canActor, hasRole, isoDateIn, type Actor } from '../../../domain/shared';
import { moneyVisibleTo, reportsVisibleTo } from '../../../domain/portal';
import type { Db } from '../_middleware/request-context';
import type { Practice } from './schema';

/**
 * Who the person signed in is, in the household's terms
 * (docs/SPEC/client-portal.md sections 2 and 7).
 *
 * **The household is resolved in the database, from the actor stamp.** Every
 * signed-in route begins here and never takes a client id from a request: the
 * ids come from `app.portal_client_ids()` (migration 700), which reads
 * `contact.user_id` against `app.current_actor_id()` and nothing a caller can
 * set. A route then still asks `canActor` for each client it is about to read,
 * so the gate is stated in the domain as well as enforced beneath — and the
 * policies refuse the row a third time if both are wrong.
 *
 * **The caller's own contact row travels with each client**, because three of
 * the portal's rules need it: whether the money may be shown at all
 * (`moneyVisibleTo`, section 5 rule 5), whether a report about that person may
 * be (`reportsVisibleTo`, `docs/SPEC/reports-v1.md` section 7.3 as amended on
 * 2026-09-06), and which row on Family is theirs to correct. A person may be a
 * contact of several clients — a mother of two — and may hold a different
 * relationship on each, so this is per client and never per person.
 */

export type HouseholdClient = {
  id: string;
  name: string;
  nameAr: string | null;
  dateOfBirth: string | null;
  preferredLocale: 'en' | 'ar';
  /** The signed-in person's own contact row on this client. */
  contactId: string;
  relationship: string;
  /** Whether this person may be shown this client's money, today. */
  moneyVisible: boolean;
  /** Whether this person may be shown a report about this client, today. */
  reportsVisible: boolean;
};

export type Household = {
  practice: Practice;
  /** The person's own language, for the portal's first render. */
  locale: 'en' | 'ar';
  /** The practice's own today, which every date rule is decided in. */
  today: string;
  clients: HouseholdClient[];
};

const PRACTICE_SQL =
  'select t.legal_name, t.legal_name_ar, t.whatsapp_number, t.timezone, ' +
  'u.preferred_locale from tenant t ' +
  'join app_user u on u.tenant_id = t.id and u.id = $1 ' +
  'where t.id = app.current_tenant_id()';

/**
 * The clients, with the caller's own contact row on each.
 *
 * `app.portal_client_ids()` decides the set; this reads the rows back under
 * row security as the caller, so a client the function named but the policies
 * refuse simply does not appear. The name is the client's own; a household
 * that reads Arabic sees the Arabic beneath it, which is the screen's business
 * and not this query's.
 */
const CLIENTS_SQL =
  'select c.id, c.given_name, c.family_name, c.given_name_ar, c.family_name_ar, ' +
  "to_char(c.date_of_birth, 'YYYY-MM-DD') as date_of_birth, c.preferred_locale, " +
  'ct.id as contact_id, ct.relationship, ct.is_legal_guardian ' +
  'from client c ' +
  'join contact ct on ct.client_id = c.id and ct.tenant_id = c.tenant_id ' +
  'where c.tenant_id = app.current_tenant_id() and c.id = any($1::uuid[]) ' +
  'and ct.user_id = $2 ' +
  'order by c.given_name, c.family_name, c.id';

type ClientRow = {
  id: string;
  given_name: string;
  family_name: string;
  given_name_ar: string | null;
  family_name_ar: string | null;
  date_of_birth: string | null;
  preferred_locale: 'en' | 'ar';
  contact_id: string;
  relationship: string;
  is_legal_guardian: boolean;
};

/** A person's name as one string, or null when the record carries none. */
export function fullName(given: string | null, family: string | null): string {
  return [given, family].filter((part) => part !== null && part.length > 0).join(' ');
}

function nameOrNull(given: string | null, family: string | null): string | null {
  const name = fullName(given, family);
  return name.length === 0 ? null : name;
}

/**
 * Reads the household, or answers null when the person signed in is not a
 * contact of anybody. A staff member reaching a portal route gets the same
 * null: their reach is the console's, and the portal is the household's view
 * of its own record.
 */
export async function readHousehold(db: Db, actor: Actor, now: Date): Promise<Household | null> {
  // A member of the practice is not a household. Their reach is the console's,
  // and a staff account that answered here would be shown a portal with no
  // clients in it — which reads as "you have no record" rather than as "this
  // screen is not yours". Refused before a query runs.
  if (!hasRole(actor, 'client_contact')) return null;

  const practiceRows = await db.query<{
    legal_name: string;
    legal_name_ar: string | null;
    whatsapp_number: string | null;
    timezone: string;
    preferred_locale: 'en' | 'ar';
  }>(PRACTICE_SQL, [actor.userId]);
  const practiceRow = practiceRows.rows[0];
  if (!practiceRow) return null;

  const ids = await db.query<{ ids: string[] }>('select app.portal_client_ids() as ids');
  const clientIds = ids.rows[0]?.ids ?? [];
  const today = isoDateIn(now, practiceRow.timezone);

  const rows =
    clientIds.length === 0
      ? { rows: [] as ClientRow[] }
      : await db.query<ClientRow>(CLIENTS_SQL, [clientIds, actor.userId]);

  return {
    practice: {
      name: practiceRow.legal_name,
      nameAr: practiceRow.legal_name_ar,
      whatsappNumber: practiceRow.whatsapp_number,
      timezone: practiceRow.timezone,
    },
    locale: practiceRow.preferred_locale,
    today,
    clients: rows.rows.map((row) => ({
      id: row.id,
      name: fullName(row.given_name, row.family_name),
      nameAr: nameOrNull(row.given_name_ar, row.family_name_ar),
      dateOfBirth: row.date_of_birth,
      preferredLocale: row.preferred_locale,
      contactId: row.contact_id,
      relationship: row.relationship,
      moneyVisible: moneyVisibleTo(
        { relationship: row.relationship },
        { dateOfBirth: row.date_of_birth },
        today,
      ),
      reportsVisible: reportsVisibleTo(
        { relationship: row.relationship, isLegalGuardian: row.is_legal_guardian },
        { dateOfBirth: row.date_of_birth },
        today,
      ),
    })),
  };
}

/**
 * The gate every portal read runs (section 5, rule 1): `client.read` for each
 * client the answer is about, with `clientIds` resolved above and never from
 * anything the request claims.
 */
export function mayReadHousehold(actor: Actor, household: Household, now: Date): boolean {
  const clientIds = household.clients.map((client) => client.id);
  return clientIds.every((clientId) =>
    canActor(actor, { type: 'client.read', clientId }, { clientIds }, now),
  );
}

/** What each screen puts at the head of its per-client sections. */
export function clientsFor(household: Household) {
  return household.clients.map((client) => ({
    id: client.id,
    name: client.name,
    nameAr: client.nameAr,
    moneyVisible: client.moneyVisible,
  }));
}

/** The clients this person may be shown money for, and no others. */
export function moneyClientIds(household: Household): string[] {
  return household.clients.filter((client) => client.moneyVisible).map((client) => client.id);
}

/**
 * The household as the Reports screen sees it: the people this person is a
 * legal guardian of, and themselves once they are an adult. A minor's own
 * login therefore reads a household with nobody in it, which is the whole of
 * the operator's decision of 2026-09-06 said in one line. The `report` read
 * policy refuses the rows in any case (migration 955); this is the same rule
 * stated where the screen can see it.
 */
export function forReports(household: Household): Household {
  return { ...household, clients: household.clients.filter((client) => client.reportsVisible) };
}
