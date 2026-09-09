/**
 * What a password may be (trunk round 40, 2026-09-10): the practice's own
 * floor, said once here and read by the page that changes one. Supabase Auth
 * holds a lower floor of its own; this one is the practice's. Pure.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/** Null when the password will do; otherwise the one sentence the person reads. */
export function passwordProblem(candidate: string): string | null {
  if (candidate.length < PASSWORD_MIN_LENGTH) {
    return `At least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (candidate.length > PASSWORD_MAX_LENGTH) {
    return `At most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (new Set(candidate).size < 4) {
    return 'More variety than that: at least four different characters.';
  }
  if (candidate.trim().length !== candidate.length) {
    return 'No space at the start or the end.';
  }
  return null;
}
