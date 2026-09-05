import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Hono } from 'hono';
import { z } from 'zod';
import { describeAccess, inviteExpiry } from '../../../domain/portal';
import { canActor } from '../../../domain/shared';
import { logAction, logReads } from '../_middleware/audit';
import type { ApiEnv } from '../_middleware/request-context';
import { fullName } from './household';
import { AccessResponse, InviteResponse, OfficeRequestsResponse, RevokeResponse } from './schema';

/**
 * The practice's own Portal screen (docs/SPEC/client-portal.md section 3.8 and
 * the office half of section 7): who has access to which record, issuing and
 * revoking it, and the household's asks.
 *
 * **The link is shown once and is never readable again.** A 32-byte token is
 * generated here, its sha256 is what `portal_invite` stores, and the answer
 * carries the link and the drafted bilingual message. Losing it costs a new
 * invitation, which is the right trade: a table of working links is a table
 * nobody should be able to steal.
 *
 * **Revoking is the account, not the link.** `app_user.status = 'suspended'`
 * is what `app.resolve_actor` reads on the very next request, so a revoked
 * household is signed out of the shell rather than merely losing a link they
 * have already used; every open invitation is closed in the same statement so
 * a second unspent link cannot let them back in. The Supabase sign-in itself
 * is deliberately left standing (section 12): suspension is the boundary.
 *
 * **What is never in an answer here.** A telephone number, an email address or
 * a token hash. The table says whether a contact *has* a number and an
 * address, because that decides whether a link can be handed over at all, and
 * the invite route answers the number only to the browser that is about to
 * open WhatsApp on it — a hand-off, composed in the browser, with nothing
 * leaving this server (docs/SEAMS.md). Every audit row names ids alone.
 */

const ContactParams = z.object({ contactId: z.uuid() });
const RequestParams = z.object({ id: z.uuid() });

/** 32 random bytes, base64url: the link's whole secret. */
const TOKEN_BYTES = 32;

const ACCESS_SQL =
  'select ct.id as contact_id, ct.client_id, ct.given_name, ct.family_name, ' +
  'ct.relationship::text as relationship, ct.phone is not null as has_phone, ' +
  'ct.email is not null as has_email, ct.user_id, ' +
  'c.given_name as client_given_name, c.family_name as client_family_name, ' +
  'u.auth_id, u.status::text as user_status, ' +
  'i.expires_at, i.used_at, i.revoked_at ' +
  'from contact ct ' +
  'join client c on c.id = ct.client_id and c.tenant_id = ct.tenant_id ' +
  'left join app_user u on u.id = ct.user_id and u.tenant_id = ct.tenant_id ' +
  'left join lateral (' +
  '  select expires_at, used_at, revoked_at from portal_invite pi ' +
  '   where pi.contact_id = ct.id order by pi.created_at desc, pi.id limit 1' +
  ') i on true ' +
  "where ct.tenant_id = app.current_tenant_id() and c.status <> 'erased' " +
  'order by c.given_name, c.family_name, ct.created_at, ct.id';

type AccessRow = {
  contact_id: string;
  client_id: string;
  given_name: string | null;
  family_name: string | null;
  relationship: string;
  has_phone: boolean;
  has_email: boolean;
  user_id: string | null;
  client_given_name: string;
  client_family_name: string;
  auth_id: string | null;
  user_status: 'active' | 'suspended' | 'archived' | null;
  expires_at: Date | null;
  used_at: Date | null;
  revoked_at: Date | null;
};

const OFFICE_REQUESTS_SQL =
  'select r.id, r.client_id, r.kind::text as kind, r.consent_id, r.note, ' +
  'r.status::text as status, r.created_at, r.handled_at, ' +
  'c.given_name as client_given_name, c.family_name as client_family_name, ' +
  'ct.given_name as asked_given_name, ct.family_name as asked_family_name, ' +
  'ct.relationship::text as asked_relationship ' +
  'from portal_request r ' +
  'join client c on c.id = r.client_id and c.tenant_id = r.tenant_id ' +
  'join contact ct on ct.id = r.contact_id and ct.tenant_id = r.tenant_id ' +
  'where r.tenant_id = app.current_tenant_id() ' +
  "order by (r.status = 'open') desc, r.created_at desc, r.id limit 200";

/**
 * The message the practice sends, in both languages. Composed here so the two
 * editions say the same thing and the screen only chooses which to copy; the
 * link is the one thing that varies and it appears once in each.
 */
function draftInvitation(practiceName: string, url: string): { en: string; ar: string } {
  return {
    en:
      `${practiceName}: here is your link to see your record — your visits, ` +
      `what is agreed and what is owed. It works once, and for seven days. ${url}`,
    ar:
      `${practiceName}: هذا رابطك لعرض سجلك — مواعيدك، وما تمت الموافقة عليه، ` +
      `وما هو مستحق. يعمل مرة واحدة، ولمدة سبعة أيام. ${url}`,
  };
}

/** Where the invitation page lives, as a path this API never has to host. */
export function invitationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/portal/invite/${token}`;
}

export function mountPortalAccess(api: Hono<ApiEnv>, now: () => Date = () => new Date()): void {
  api.get('/api/portal/access', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const { rows } = await db.query<AccessRow>(ACCESS_SQL);

    await logReads(
      db,
      'contact',
      rows.map((row) => ({ id: row.contact_id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      AccessResponse.parse({
        access: rows.map((row) => {
          const state = describeAccess(
            { userId: row.user_id },
            row.user_id === null || row.user_status === null
              ? null
              : { authId: row.auth_id, status: row.user_status },
            row.expires_at === null
              ? null
              : {
                  expiresAt: row.expires_at,
                  usedAt: row.used_at,
                  revokedAt: row.revoked_at,
                },
            now(),
          );
          return {
            contactId: row.contact_id,
            clientId: row.client_id,
            clientName: fullName(row.client_given_name, row.client_family_name),
            name: fullName(row.given_name, row.family_name),
            relationship: row.relationship,
            hasPhone: row.has_phone,
            hasEmail: row.has_email,
            state: state.state,
            expiresAt: state.expiresAt?.toISOString() ?? null,
            since: state.since?.toISOString() ?? null,
          };
        }),
      }),
    );
  });

  api.post('/api/portal/access/:contactId/invite', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = ContactParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const db = c.get('db');

    const found = await db.query<{
      contact_id: string;
      client_id: string;
      given_name: string | null;
      family_name: string | null;
      phone: string | null;
      email: string | null;
      user_id: string | null;
      auth_id: string | null;
      user_status: 'active' | 'suspended' | 'archived' | null;
      preferred_locale: 'en' | 'ar';
      legal_name: string;
    }>(
      'select ct.id as contact_id, ct.client_id, ct.given_name, ct.family_name, ct.phone, ' +
        'ct.email, ct.user_id, u.auth_id, u.status::text as user_status, ' +
        'c.preferred_locale, t.legal_name ' +
        'from contact ct ' +
        'join client c on c.id = ct.client_id and c.tenant_id = ct.tenant_id ' +
        'join tenant t on t.id = ct.tenant_id ' +
        'left join app_user u on u.id = ct.user_id and u.tenant_id = ct.tenant_id ' +
        "where ct.tenant_id = app.current_tenant_id() and ct.id = $1 and c.status <> 'erased'",
      [params.data.contactId],
    );
    const row = found.rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);

    let userId = row.user_id;
    if (userId === null) {
      // No account yet: one is created here, with the household's own language
      // taken from the client's record, and linked onto the contact row. The
      // sign-in itself does not exist until the person walks through the door
      // and chooses a password (`auth_id` stays null until then).
      userId = randomUUID();
      await db.query(
        'insert into app_user (id, tenant_id, display_name, preferred_locale, status) ' +
          "values ($1, $2, $3, $4::locale, 'active')",
        [
          userId,
          actor.tenantId,
          fullName(row.given_name, row.family_name) || 'Client contact',
          row.preferred_locale,
        ],
      );
      await db.query(
        "insert into user_role (tenant_id, user_id, role) values ($1, $2, 'client_contact')",
        [actor.tenantId, userId],
      );
      await db.query('update contact set user_id = $1 where id = $2', [userId, row.contact_id]);
    } else if (row.user_status !== 'active') {
      // Invited again after a revocation: the account comes back on, and the
      // link below is what puts a sign-in behind it.
      await db.query("update app_user set status = 'active' where id = $1", [userId]);
    }

    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest();
    const kind = row.auth_id === null ? 'first_sign_in' : 'password_reset';
    const expiresAt = inviteExpiry(now());
    const inviteId = randomUUID();

    // Any outstanding invitation is closed first: two live links to one
    // household is one more than the practice meant to hand out.
    await db.query(
      'update portal_invite set revoked_at = now() where contact_id = $1 ' +
        'and used_at is null and revoked_at is null',
      [row.contact_id],
    );
    await db.query(
      'insert into portal_invite (id, tenant_id, client_id, contact_id, user_id, kind, ' +
        'locale, token_hash, expires_at, created_by) ' +
        'values ($1, $2, $3, $4, $5, $6::portal_invite_kind, $7::locale, $8, $9, $10)',
      [
        inviteId,
        actor.tenantId,
        row.client_id,
        row.contact_id,
        userId,
        kind,
        row.preferred_locale,
        tokenHash,
        expiresAt,
        actor.userId,
      ],
    );
    await logAction(
      db,
      'portal.invite.sent',
      { type: 'portal_invite', id: inviteId, clientId: row.client_id },
      // The contact's id and the kind. Never the token, never the number.
      { contactId: row.contact_id, kind },
    );

    const origin = new URL(c.req.url).origin;
    const url = invitationUrl(origin, token);
    return c.json(
      InviteResponse.parse({
        contactId: row.contact_id,
        kind,
        url,
        expiresAt: expiresAt.toISOString(),
        message: draftInvitation(row.legal_name, url),
        phone: row.phone,
      }),
      201,
    );
  });

  api.post('/api/portal/access/:contactId/revoke', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.access.manage' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = ContactParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const db = c.get('db');

    const found = await db.query<{ contact_id: string; client_id: string; user_id: string | null }>(
      'select id as contact_id, client_id, user_id from contact ' +
        'where tenant_id = app.current_tenant_id() and id = $1',
      [params.data.contactId],
    );
    const row = found.rows[0];
    if (!row) return c.json({ error: 'not_found', requestId }, 404);
    if (row.user_id === null) {
      // Nobody to switch off. Not an error: the practice pressed a button
      // beside a contact who never had access, and the state is already what
      // was wanted.
      return c.json(RevokeResponse.parse({ contactId: row.contact_id, state: 'none' }));
    }

    await db.query("update app_user set status = 'suspended' where id = $1", [row.user_id]);
    await db.query(
      'update portal_invite set revoked_at = now() where contact_id = $1 ' +
        'and used_at is null and revoked_at is null',
      [row.contact_id],
    );
    await logAction(
      db,
      'portal.access.revoked',
      { type: 'app_user', id: row.user_id, clientId: row.client_id },
      { contactId: row.contact_id },
    );

    return c.json(RevokeResponse.parse({ contactId: row.contact_id, state: 'revoked' }));
  });

  api.get('/api/portal/requests', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.request.handle' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const db = c.get('db');
    const { rows } = await db.query<{
      id: string;
      client_id: string;
      kind: string;
      consent_id: string | null;
      note: string | null;
      status: string;
      created_at: Date;
      handled_at: Date | null;
      client_given_name: string;
      client_family_name: string;
      asked_given_name: string | null;
      asked_family_name: string | null;
      asked_relationship: string;
    }>(OFFICE_REQUESTS_SQL);

    await logReads(
      db,
      'portal_request',
      rows.map((row) => ({ id: row.id, clientId: row.client_id })),
      'list',
    );

    return c.json(
      OfficeRequestsResponse.parse({
        requests: rows.map((row) => ({
          id: row.id,
          clientId: row.client_id,
          kind: row.kind,
          consentId: row.consent_id,
          note: row.note,
          status: row.status,
          createdAt: row.created_at.toISOString(),
          handledAt: row.handled_at?.toISOString() ?? null,
          clientName: fullName(row.client_given_name, row.client_family_name),
          askedByName: fullName(row.asked_given_name, row.asked_family_name),
          askedByRelationship: row.asked_relationship,
        })),
      }),
    );
  });

  api.post('/api/portal/requests/:id/handle', async (c) => {
    const requestId = c.get('requestId');
    const actor = c.get('actor');
    if (!canActor(actor, { type: 'portal.request.handle' }, {}, now())) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const params = RequestParams.safeParse(c.req.param());
    if (!params.success) return c.json({ error: 'bad_request', requestId }, 400);
    const db = c.get('db');

    // Only the handling columns move; app.guard_portal_request (migration 701)
    // refuses every other change structurally beneath this.
    const updated = await db.query<{ id: string; client_id: string }>(
      "update portal_request set status = 'handled', handled_at = now(), handled_by = $2 " +
        "where tenant_id = app.current_tenant_id() and id = $1 and status = 'open' " +
        'returning id, client_id',
      [params.data.id, actor.userId],
    );
    const row = updated.rows[0];
    if (!row) {
      // Already handled, another practice's, or none. All three are the same
      // answer: there is nothing here to mark.
      return c.json({ error: 'not_found', requestId }, 404);
    }
    await logAction(
      db,
      'portal.request.handled',
      { type: 'portal_request', id: row.id, clientId: row.client_id },
      { handledBy: actor.userId },
    );
    return c.json({ id: row.id, status: 'handled' });
  });
}
