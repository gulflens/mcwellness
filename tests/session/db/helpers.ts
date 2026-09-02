import type pg from 'pg';

/**
 * Small seed helpers for session-capture's own database tests, extending
 * tests/db/helpers.ts (owned by the trunk) with the consent and document
 * rows canCheckIn's gate needs. Every id and phone stays inside the
 * reserved synthetic ranges (.claude/rules/testing.md).
 */

/** A minimal practice document to stand behind a consent's wording (00-data-model.md section 3). */
export async function seedConsentDocument(
  client: pg.Client,
  tenantId: string,
  id: string,
): Promise<void> {
  const storageKey = `consent-wording-${id}`;
  await client.query(
    'insert into document (id, tenant_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, 'consent', $3, 'application/pdf', sha256($4::bytea))",
    [id, tenantId, storageKey, storageKey],
  );
}

/**
 * A booked visit (db/migrations/200_appointment.sql), the fixture
 * app.checkin_context's own tests and the check-in route's happy paths both
 * need now that found is tied to "this practitioner has an appointment with
 * this client today" (db/migrations/301_checkin_context.sql). windowStart is
 * a full timestamptz string; window_end is derived (the table's own 45-minute
 * check), and travel_buffer_minutes takes its column default.
 */
export async function seedAppointment(
  client: pg.Client,
  appointment: {
    id: string;
    tenantId: string;
    clientId: string;
    practitionerId: string;
    serviceTypeId: string;
    locationId: string;
    windowStart: string;
    status?:
      | 'proposed'
      | 'confirmed'
      | 'checked_in'
      | 'completed'
      | 'cancelled'
      | 'cancelled_late'
      | 'no_show'
      | 'rescheduled';
  },
): Promise<void> {
  await client.query(
    'insert into appointment (id, tenant_id, client_id, practitioner_id, service_type_id, ' +
      'location_id, delivery_mode, window_start, window_end, status) values ' +
      "($1, $2, $3, $4, $5, $6, 'home', $7, $7::timestamptz + interval '45 minutes', $8)",
    [
      appointment.id,
      appointment.tenantId,
      appointment.clientId,
      appointment.practitionerId,
      appointment.serviceTypeId,
      appointment.locationId,
      appointment.windowStart,
      appointment.status ?? 'proposed',
    ],
  );
}

export async function seedConsent(
  client: pg.Client,
  consent: {
    id: string;
    tenantId: string;
    clientId: string;
    givenByContactId: string;
    purpose: 'participation' | 'minor_participation' | 'home_visit';
    textDocumentId: string;
    status?: 'active' | 'withdrawn' | 'expired' | 'superseded';
  },
): Promise<void> {
  await client.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      "text_document_id, status, method) values ($1, $2, $3, $4, $5, 1, $6, $7, 'app_signature')",
    [
      consent.id,
      consent.tenantId,
      consent.clientId,
      consent.givenByContactId,
      consent.purpose,
      consent.textDocumentId,
      consent.status ?? 'active',
    ],
  );
}
