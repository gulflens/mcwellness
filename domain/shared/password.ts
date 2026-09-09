/**
 * What a password may be (trunk round 40, 2026-09-10): the practice's own
 * floor, said once here and read by the pages that change one. Supabase Auth
 * holds a lower floor of its own; this one is the practice's. Pure.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 200;

/**
 * Why a password will not do, by name rather than by sentence, so that a page
 * in another language can say it in its own words (trunk round 41: the
 * household's portal is bilingual, docs/SPEC/client-portal.md section 3).
 */
export type PasswordProblemKey = 'short' | 'long' | 'variety' | 'edges';

/** Null when the password will do; otherwise which rule it fails. */
export function passwordProblemKey(candidate: string): PasswordProblemKey | null {
  if (candidate.length < PASSWORD_MIN_LENGTH) return 'short';
  if (candidate.length > PASSWORD_MAX_LENGTH) return 'long';
  if (new Set(candidate).size < 4) return 'variety';
  if (candidate.trim().length !== candidate.length) return 'edges';
  return null;
}

/** The console's English for each key; the portal has its own dictionary. */
export const PASSWORD_PROBLEM_SENTENCES: Record<PasswordProblemKey, string> = {
  short: `At least ${PASSWORD_MIN_LENGTH} characters.`,
  long: `At most ${PASSWORD_MAX_LENGTH} characters.`,
  variety: 'More variety than that: at least four different characters.',
  edges: 'No space at the start or the end.',
};

/** Null when the password will do; otherwise the one sentence the person reads. */
export function passwordProblem(candidate: string): string | null {
  const key = passwordProblemKey(candidate);
  return key ? PASSWORD_PROBLEM_SENTENCES[key] : null;
}
