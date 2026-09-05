import type pg from 'pg';

/**
 * Seed helpers for the assessment stream's own database tests, extending
 * tests/db/helpers.ts (the trunk's) with the rows a measurement needs around
 * it: a booked visit, so a client is on a practitioner's schedule; the
 * consents the recording gate reads; and a filed document to hang a link on.
 *
 * Every id, phone and name stays inside the reserved synthetic ranges
 * (.claude/rules/testing.md). Nothing here describes a real person, a real
 * instrument or a real piece of software.
 */

/**
 * Ids for this stream's fixtures, in the reserved shape
 * (.claude/rules/testing.md). The scenario sits at the **end** of the tail
 * rather than the start, because `seedClient` builds a record number from the
 * last six characters of a client's id: with the scenario in front, every
 * scenario's client would ask for the same MRN and the second would collide.
 */
export function assessmentId(scenario: string, slot: number): string {
  return `0000000f-0000-4000-8000-${String(slot).padStart(6, '0')}${scenario.padStart(6, '0')}`;
}

/**
 * A practice document to stand behind a consent's wording (00-data-model.md
 * section 3). Filed as `consent` rather than `consent_text`: the latter is the
 * published wording and migration 907 requires four more columns with it,
 * which a fixture standing in for "some document" has no business inventing.
 */
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

/** A file filed against one client, as the assessment link table's fixture. */
export async function seedClientDocument(
  client: pg.Client,
  document: { id: string; tenantId: string; clientId: string; digest: string },
): Promise<void> {
  await client.query(
    'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256) ' +
      "values ($1, $2, $3, 'assessment_raw', $4, 'application/pdf', sha256($5::bytea))",
    [
      document.id,
      document.tenantId,
      document.clientId,
      `tenant/${document.tenantId}/client/${document.clientId}/${document.id}`,
      document.digest,
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
    /**
     * When the agreement runs out. Nothing in the schema stops a row from
     * saying `active` with a date already past — the status is what a person
     * did, the date is what time did — so the gate must read both, and a
     * fixture that can set one without the other is how that is proved.
     */
    expiresAt?: string | null;
  },
): Promise<void> {
  await client.query(
    'insert into consent (id, tenant_id, client_id, given_by_contact_id, purpose, version, ' +
      'text_document_id, status, expires_at, method) values ($1, $2, $3, $4, $5, 1, $6, $7, $8, ' +
      "'app_signature')",
    [
      consent.id,
      consent.tenantId,
      consent.clientId,
      consent.givenByContactId,
      consent.purpose,
      consent.textDocumentId,
      consent.status ?? 'active',
      consent.expiresAt ?? null,
    ],
  );
}

export async function seedContact(
  client: pg.Client,
  contact: { id: string; tenantId: string; clientId: string; userId?: string | null },
): Promise<void> {
  await client.query(
    'insert into contact (id, tenant_id, client_id, user_id, relationship, can_consent) ' +
      "values ($1, $2, $3, $4, 'mother', true)",
    [contact.id, contact.tenantId, contact.clientId, contact.userId ?? null],
  );
}

/**
 * A visit on the practitioner's schedule, which is what puts a client inside
 * `app.client_visible_to_practitioner`'s ninety-days-back window
 * (201_client_visible_to_practitioner.sql). Confirmed, and starting today in
 * the practice's own zone.
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
    status?: 'proposed' | 'confirmed' | 'checked_in' | 'completed' | 'no_show' | 'rescheduled';
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
      appointment.status ?? 'confirmed',
    ],
  );
}

/** The figures a synthetic brain map carries. Nothing here is a real reading. */
export function brainMapPayload(alphaAtFz: number): Record<string, unknown> {
  return {
    kind: 'brain-map',
    provenance: { software: 'Synthetic Mapping Suite', softwareVersion: '3.2.1' },
    condition: 'eyes-closed',
    figures: [
      { site: 'Fz', band: 'alpha', value: alphaAtFz, unit: 'uV2' },
      { site: 'Cz', band: 'theta', value: 8.4, unit: 'uV2' },
    ],
  };
}

/** A measurement written straight in, as the table owner, for a read test to find. */
export async function seedAssessment(
  client: pg.Client,
  assessment: {
    id: string;
    tenantId: string;
    clientId: string;
    practitionerId: string;
    performedAt?: string;
    conditionNote?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    'insert into assessment (id, tenant_id, client_id, performed_by_practitioner_id, ' +
      'performed_at, instrument, instrument_version, derived, condition_note, ' +
      'reference_age_years, reference_sex) ' +
      "values ($1, $2, $3, $4, $5, 'qeeg', '1', $6::jsonb, $7, 9, 'female')",
    [
      assessment.id,
      assessment.tenantId,
      assessment.clientId,
      assessment.practitionerId,
      assessment.performedAt ?? new Date().toISOString(),
      JSON.stringify(assessment.payload ?? brainMapPayload(10)),
      assessment.conditionNote ?? 'Eyes closed, quiet room, one artefact at the start.',
    ],
  );
}
