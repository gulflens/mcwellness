import type { Contact } from '../../api/clients/record-schema';

/**
 * A contact's name, wherever one is shown
 * (db/migrations/101_contact_name.sql, CR-07 of
 * docs/CHANGE-REQUESTS/client-record-02.md).
 *
 * Until that migration every screen listing a contact said "Mother" and never
 * who, which is awkward on a list of three and a real problem on a consent: a
 * `minor_participation` consent is valid because a legal guardian gave it, and
 * "Given by: Mother" does not identify a person when a household holds two
 * contacts with the same relationship.
 *
 * Both halves are nullable, and either alone is still a name worth showing —
 * a practice knows plenty of people by one name. Null comes back when there is
 * nothing at all, so a caller can fall back to the relationship rather than
 * render an empty string.
 */
export function contactName(
  contact: Pick<Contact, 'givenName' | 'familyName'> | null | undefined,
): string | null {
  if (!contact) return null;
  const name = [contact.givenName, contact.familyName].filter(Boolean).join(' ').trim();
  return name === '' ? null : name;
}

/** A relationship in words, never the raw enum value a screen should not show. */
const RELATIONSHIP_LABELS: Record<string, string> = {
  self: 'Self',
  mother: 'Mother',
  father: 'Father',
  guardian: 'Guardian',
  spouse: 'Spouse',
  other: 'Other',
};

export function relationshipLabel(relationship: string): string {
  return RELATIONSHIP_LABELS[relationship] ?? relationship;
}

/**
 * The placeholder `app.erase_client` writes into both halves of an erased
 * client's name (db/migrations/100_client_record.sql). The database needs
 * something in each column; a screen does not need to say it twice.
 */
const ERASED_NAME = 'Erased client';

/**
 * A client's name as a heading reads it: both halves, or the erasure's
 * placeholder said once.
 *
 * "Erased client Erased client" is what a straight join gives, and it is the
 * kind of detail that makes a person doubt everything else on the screen.
 */
export function clientHeadingName(givenName: string, familyName: string): string {
  if (givenName === ERASED_NAME && familyName === ERASED_NAME) return ERASED_NAME;
  return [givenName, familyName].filter(Boolean).join(' ').trim();
}

/**
 * The name a screen shows for a contact, with the one fallback a `self` contact
 * needs: the wizard files the client's own phone under a contact with no name
 * of its own, so "Unnamed contact — self" on a consent was the client being
 * asked to sign as nobody (the walk of 10 September). The client's own name is
 * the honest label; any other unnamed contact keeps the relationship.
 */
export function contactDisplayName(
  contact: Pick<Contact, 'givenName' | 'familyName' | 'relationship'>,
  client: { givenName: string; familyName: string },
): string {
  const own = contactName(contact);
  if (own) return own;
  if (contact.relationship === 'self') {
    return clientHeadingName(client.givenName, client.familyName);
  }
  return relationshipLabel(contact.relationship);
}
