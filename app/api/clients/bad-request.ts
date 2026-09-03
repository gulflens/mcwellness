import type { ZodError } from 'zod';

/**
 * Which parts of a body were rejected, by the path zod rejected them at —
 * "contact.phone", "dateOfBirth" — and never why in the caller's own words,
 * and never the value. The screen needs to name a field so the person can fix
 * it; a 400 that says only "bad_request" sends them round the same form
 * forever (design review of pull request 35).
 *
 * Paths only. A zod message can quote what it was given, and a rejected value
 * is a phone number or a date of birth: it must not travel in an error any
 * more than it may travel in a log (CLAUDE.md rule 5).
 */
export function rejectedFields(error: ZodError): string[] {
  const paths = error.issues.map((issue) =>
    issue.path.filter((part) => typeof part === 'string').join('.'),
  );
  return [...new Set(paths.filter((path) => path.length > 0))];
}
