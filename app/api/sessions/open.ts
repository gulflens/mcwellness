import type { Hono } from 'hono';
import { hasRole } from '@domain/shared';
import { replayEvents, sessionNumber, type SessionHistoryEntry } from '@domain/session';
import { logRead } from '../_middleware/audit';
import type { ApiEnv, Db } from '../_middleware/request-context';
import { OpenSessionResponse } from './schema';
import { lastSeqOf, loadOpenSession, readEvents, resolvePractitioner } from './session-row';

/**
 * GET /api/sessions/open — the visit this practitioner left open, if there
 * is one.
 *
 * This is what makes "resume session for Client L., started 14:32" possible
 * after a phone dies or an app is force-quit (docs/SPEC/session-capture.md
 * section 2). The device's own outbox survives that on its own; this is the
 * second half of the answer, for a device that has been wiped, replaced, or
 * simply reloaded before its first flush.
 *
 * A given name and a family initial, never a full family name: the same
 * reduction the day sheet already makes (app/api/appointments/schema.ts), so
 * the browser is never handed more of a person's name than the screen shows.
 * When row security shows the practitioner no client at all — the client
 * record stream's window (201) opens on a *confirmed* appointment, and a
 * visit still sitting at 'proposed' is outside it — the offer degrades to
 * the time alone rather than failing: the practitioner knows which visit
 * they are standing in.
 *
 * Reading a client's name is a read of personal data, so it is audited
 * (audit.md section 5, layer 2) exactly as every other one is.
 */

const PRACTITIONER_ROLES = ['practitioner', 'lead_practitioner'] as const;

type ClientRow = { given_name: string; family_initial: string | null; service_name: string };

async function readWho(db: Db, clientId: string, serviceTypeId: string): Promise<ClientRow | null> {
  const { rows } = await db.query<ClientRow>(
    "select c.given_name, nullif(left(c.family_name, 1), '') as family_initial, " +
      's.name as service_name ' +
      'from client c, service_type s ' +
      'where c.id = $1 and c.tenant_id = app.current_tenant_id() ' +
      'and s.id = $2 and s.tenant_id = app.current_tenant_id()',
    [clientId, serviceTypeId],
  );
  return rows[0] ?? null;
}

type HistoryRow = {
  id: string;
  service_type_id: string;
  status: string;
  checked_in_at: Date;
};

// No clock: nothing this route answers depends on the time of day.
export function mountOpenSession(api: Hono<ApiEnv>): void {
  api.get('/api/sessions/open', async (c) => {
    const actor = c.get('actor');
    const requestId = c.get('requestId');
    const db = c.get('db');

    if (!hasRole(actor, ...PRACTITIONER_ROLES)) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }
    const practitionerId = await resolvePractitioner(db, actor.userId);
    if (!practitionerId) {
      return c.json({ error: 'forbidden', requestId }, 403);
    }

    const session = await loadOpenSession(db, practitionerId);
    if (!session) {
      return c.json(OpenSessionResponse.parse({ session: null }));
    }

    const events = await readEvents(db, session.id);
    const projection = replayEvents(events);
    const who = await readWho(db, session.client_id, session.service_type_id);

    // app.session_history_for (304): the client's own visits across every
    // practitioner, which practitioner_scope deliberately will not show and
    // "Session 12 of 30" needs. Entitlements are billing's ledger and this
    // stream neither reads nor writes it, so the denominator is unknown for
    // now and the screen says "Session 12" rather than inventing one.
    const history = await db.query<HistoryRow>(
      'select id, service_type_id, status, checked_in_at from app.session_history_for($1)',
      [session.id],
    );
    const count = sessionNumber(
      history.rows.map((row): SessionHistoryEntry => ({
        id: row.id,
        serviceTypeId: row.service_type_id,
        status: row.status as SessionHistoryEntry['status'],
        checkedInAt: row.checked_in_at.toISOString(),
      })),
      {
        id: session.id,
        serviceTypeId: session.service_type_id,
        checkedInAt: session.checked_in_at.toISOString(),
      },
      [],
    );

    const photo = await db.query<{ active: boolean }>(
      "select app.session_consent_active($1, 'photo_video') as active",
      [session.id],
    );

    await logRead(db, 'session', session.id, session.client_id);

    return c.json(
      OpenSessionResponse.parse({
        session: {
          id: session.id,
          clientGivenName: who?.given_name ?? '',
          clientFamilyInitial: who?.family_initial ?? null,
          serviceTypeId: session.service_type_id,
          serviceName: who?.service_name ?? '',
          deliveryMode: session.delivery_mode,
          checkedInAt: session.checked_in_at.toISOString(),
          phase: projection?.phase ?? 'in_progress',
          number: count.number,
          of: count.of,
          lastSeq: lastSeqOf(events),
          photoConsent: photo.rows[0]?.active === true,
        },
      }),
    );
  });
}
