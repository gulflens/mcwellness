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

/** The Arabic pair, for the one place it is rendered beneath the Latin one. */
export function contactNameAr(
  contact: Pick<Contact, 'givenNameAr' | 'familyNameAr'> | null | undefined,
): string | null {
  if (!contact) return null;
  const name = [contact.givenNameAr, contact.familyNameAr].filter(Boolean).join(' ').trim();
  return name === '' ? null : name;
}

/**
 * The Arabic name, rendered the way every Arabic string in this console is:
 * `lang="ar" dir="rtl"`, so it is shaped and ordered correctly whatever the
 * page around it is doing (CLAUDE.md, docs/DESIGN-BRIEF.md).
 */
export function ContactNameAr({
  contact,
}: {
  contact: Pick<Contact, 'givenNameAr' | 'familyNameAr'>;
}) {
  const name = contactNameAr(contact);
  if (name === null) return null;
  return (
    <p className="small muted" lang="ar" dir="rtl">
      {name}
    </p>
  );
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
