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
