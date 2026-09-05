import type { Hono } from 'hono';
import { z } from 'zod';
import { canActor } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { clientsFor, fullName, readHousehold, type Household } from './household';
import { logPortalRefusal } from './refused';
import { FamilyResponse, UpdateContactInput } from './schema';

/**
 * `GET /api/portal/family` — who is on the record, and where the practitioner
 * drives (docs/SPEC/client-portal.md section 3.4) — and
 * `PATCH /api/portal/contacts/:contactId`, the one form the portal has.
 *
 * **The address is read-only, and the reason is on the screen.** The day sheet
 * reads it live, so an edit moves where somebody drives, and a move may change
 * the zone, which is the practice's call. What the household is shown of it is
 * the line and the emirate; the coordinate, the parking point, the community
 * gate, the arrival notes and the Makani number are never selected, because
 * they are what the practitioner navigates by and not what the family reads.
 *
 * **The form changes three fields.** The route asks `contact.write_own`, which
 * compares the contact row's own `user_id` with the actor's; row security
 * refuses a row that is not theirs; and `app.guard_contact_self_service`
 * (migration 702) refuses every column but the three, structurally, so a
 * column added to `contact` later is guarded without anyone remembering it.
 * Three answers to one question, and the database's is the one that counts.
 */

const ContactParams = z.object({ contactId: z.uuid() });

const ADDRESS_SQL =
  'select l.owner_id as client_id, l.display_address, l.emirate::text as emirate ' +
  'from location l ' +
  "where l.tenant_id = app.current_tenant_id() and l.owner_type = 'client' " +
  'and l.owner_id = any($1::uuid[]) and l.is_primary ' +
  'order by l.owner_id, l.created_at';

const PEOPLE_SQL =
  'select ct.id, ct.client_id, ct.given_name, ct.family_name, ct.given_name_ar, ' +
  'ct.family_name_ar, ct.relationship::text as relationship, ct.can_consent, ' +
  'ct.can_receive_reports, ct.can_pay, ct.phone, ct.email, ct.whatsapp_opt_in, ct.user_id ' +
  'from contact ct where ct.tenant_id = app.current_tenant_id() ' +
  'and ct.client_id = any($1::uuid[]) order by ct.client_id, ct.created_at, ct.id';

type PersonRow = {
  id: string;
  client_id: string;
  given_name: string | null;
  family_name: string | null;
  given_name_ar: string | null;
  family_name_ar: string | null;
  relationship: string;
  can_consent: boolean;
  can_receive_reports: boolean;
  can_pay: boolean;
  phone: string | null;
  email: string | null;
  whatsapp_opt_in: boolean;
  user_id: string | null;
};

/** The contact row this person holds on this client, or null. */
async function ownContact(
  db: Db,
  household: Household,
  contactId: string,
): Promise<{ id: string; clientId: string; userId: string | null } | null> {
  const clientIds = household.clients.map((client) => client.id);
  if (clientIds.length === 0) return null;
  const { rows } = await db.query<{ id: string; client_id: string; user_id: string | null }>(
    'select id, client_id, user_id from contact ' +
      'where tenant_id = app.current_tenant_id() and id = $1 and client_id = any($2::uuid[])',
    [contactId, clientIds],
  );
  const row = rows[0];
  return row ? { id: row.id, clientId: row.client_id, userId: row.user_id } : null;
}

export function mountPortalFamily(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/family', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const clientIds = household.clients.map((client) => client.id);
    const [addresses, people] = await Promise.all([
      clientIds.length === 0
        ? { rows: [] as { client_id: string; display_address: string | null; emirate: string }[] }
        : db.query<{ client_id: string; display_address: string | null; emirate: string }>(
            ADDRESS_SQL,
            [clientIds],
          ),
      clientIds.length === 0
        ? { rows: [] as PersonRow[] }
        : db.query<PersonRow>(PEOPLE_SQL, [clientIds]),
    ]);

    await logReads(
      db,
      'contact',
      people.rows.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      FamilyResponse.parse({
        clients: clientsFor(household).map((client) => {
          const address = addresses.rows.find((row) => row.client_id === client.id) ?? null;
          return {
            ...client,
            address: address
              ? { displayAddress: address.display_address, emirate: address.emirate }
              : null,
          };
        }),
        people: people.rows.map((row) => ({
          id: row.id,
          clientId: row.client_id,
          name: fullName(row.given_name, row.family_name),
          nameAr:
            fullName(row.given_name_ar, row.family_name_ar).length === 0
              ? null
              : fullName(row.given_name_ar, row.family_name_ar),
          relationship: row.relationship,
          canConsent: row.can_consent,
          canReceiveReports: row.can_receive_reports,
          canPay: row.can_pay,
          phone: row.phone,
          email: row.email,
          whatsappOptIn: row.whatsapp_opt_in,
          isYou: row.user_id === actor.userId,
        })),
      }),
    );
  });

  api.patch('/api/portal/contacts/:contactId', async (c) => {
    const requestId = c.get('requestId');
    const db = c.get('db');
    const actor = c.get('actor');
    const params = ContactParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);

    const household = await readHousehold(db, actor, now());
    if (household === null) return c.json({ error: 'forbidden', requestId }, 403);

    const body = UpdateContactInput.safeParse(await c.req.json().catch(() => null));
    if (!body.success) {
      // A code, never zod's own message: the screen holds the sentences, and a
      // message could echo what somebody typed into a field.
      const field = body.error.issues[0]?.path[0];
      return c.json({ error: 'bad_request', code: String(field ?? 'invalid'), requestId }, 400);
    }

    const contact = await ownContact(db, household, params.data.contactId);
    if (contact === null) {
      // Another household's row, or none. Not found either way: a refusal here
      // would confirm the contact exists.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    if (!canActor(actor, { type: 'contact.write_own', contactUserId: contact.userId }, {}, now())) {
      // Somebody else on the household's own record — the other parent's row.
      // Refused, and recorded as a refusal, because it names a real row.
      await logPortalRefusal(db, 'contact', contact.id, contact.clientId);
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    await db.query(
      'update contact set phone = $1, email = $2, whatsapp_opt_in = $3 where id = $4',
      [body.data.phone, body.data.email, body.data.whatsappOptIn, contact.id],
    );
    // The row trigger has already recorded which columns moved, with the
    // values redacted where the trail redacts them; this says the household
    // did it themselves, with the contact's id and nothing else.
    await logAction(
      db,
      'portal.contact.corrected',
      { type: 'contact', id: contact.id, clientId: contact.clientId },
      { contactId: contact.id },
    );

    return c.json({ id: contact.id });
  });
}
