import { z } from 'zod';
import { STAFF_ROLES, isRealDate } from '@domain/shared';

/**
 * What Settings › Team sends and is answered (trunk round 39, 2026-09-10;
 * the profile and the access switches, round 58, 2026-09-21).
 *
 * A member of staff is a name, an address to sign in with, a status and the
 * roles they hold — and, from round 58, an employee's profile behind it: a job
 * title, a start date, an emergency contact and the owners' own notes, which
 * live in `staff_profile` and are the owners' alone to read or write. The one
 * thing that crosses the wire once and is never stored is the temporary
 * password a new sign-in is created with: the operator's decision of 10
 * September, so a colleague can be given their way in across a desk or by
 * WhatsApp until a "change my password" screen exists.
 */
export const STAFF_STATUSES = ['active', 'suspended', 'archived'] as const;

export const TeamMember = z.object({
  id: z.uuid(),
  displayName: z.string(),
  email: z.string().nullable(),
  status: z.enum(STAFF_STATUSES),
  roles: z.array(z.string()),
  /** The row that is the person reading: it has no suspend button. */
  isYou: z.boolean(),
  /** Holds ownership: nothing on the row is anybody's to change. */
  locked: z.boolean(),
  /** Sent to an owner only; null otherwise and when none is recorded. */
  jobTitle: z.string().nullable(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const TeamListResponse = z.object({ members: z.array(TeamMember) });
export type TeamListResponse = z.infer<typeof TeamListResponse>;

export const InviteBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(200)
    .regex(/^[^\s@]+@[^\s@]+$/, 'An email address is name@example.com.'),
  roles: z.array(z.enum(STAFF_ROLES)).min(1).max(STAFF_ROLES.length),
  preferredLocale: z.enum(['en', 'ar']).default('en'),
});
export type InviteBody = z.infer<typeof InviteBody>;

export const InviteResponse = z.object({ userId: z.uuid(), temporaryPassword: z.string() });
export type InviteResponse = z.infer<typeof InviteResponse>;

export const StatusBody = z.object({ status: z.enum(['active', 'suspended']) });

/**
 * E.164, the shape `app_user.phone` and `staff_profile.emergency_contact_phone`
 * both carry a check constraint for. Said here as well as there so a mistyped
 * number is a 400 a person can act on rather than a constraint violation.
 */
const E164 = /^\+[1-9][0-9]{6,14}$/;

/**
 * A box on the profile that may be left empty. An empty box is nothing
 * recorded, not an empty string: the column's own check refuses a blank job
 * title or a blank name, and a person who clears a field means "there is none".
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable();

/**
 * A day the calendar actually has, written YYYY-MM-DD.
 *
 * The shape alone is not enough, and the difference is a status code: `31
 * February` and `29 February 2025` both pass the pattern and are both refused
 * by Postgres as dates, so without the refinement a mistyped start date is a
 * 500 instead of the 400 a typo deserves (round 58's review, ruling R6).
 * `isRealDate` (domain/shared/dates.ts) is this platform's one answer to
 * whether a day exists, leap years included, and it reads no clock — so this
 * stays a pure refinement, as every rule in `domain/` is.
 *
 * Used on the way out as well as in. A `date` column can hold nothing else, so
 * the refinement never fires on a response; it is there so the contract reads
 * the same in both directions.
 */
const CalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    return isRealDate(year ?? 0, month ?? 0, day ?? 0);
  }, 'That day is not on the calendar.');

/**
 * One colleague, opened. Everything `TeamMember` carries plus what
 * `staff_profile` holds, which is why it is the owners' answer alone
 * (db/policies/core/staff_profile.sql).
 */
export const TeamProfile = TeamMember.extend({
  phone: z.string().nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  startedOn: CalendarDate.nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  privateNotes: z.string().nullable(),
  /** Whether the person reading may save this profile (`canEditProfile`). */
  editable: z.boolean(),
});
export type TeamProfile = z.infer<typeof TeamProfile>;

/**
 * What the drawer's one Save button sends: the whole profile every time, so a
 * field left out is a field cleared and there is no half-written state to
 * reason about.
 */
export const ProfileBody = z.object({
  displayName: z.string().trim().min(1).max(120),
  email: InviteBody.shape.email,
  phone: z.string().regex(E164).nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  jobTitle: optionalText(120),
  startedOn: CalendarDate.nullable(),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: z.string().regex(E164).nullable(),
  privateNotes: optionalText(4000),
});
export type ProfileBody = z.infer<typeof ProfileBody>;

/**
 * The codes a refusal carries, which the screen turns into a sentence
 * (design section 7). `locked` and `last_role` are 409, `not_yourself` and
 * `not_a_working_role` 400.
 *
 * `conflict` is the fifth and is not a rule but a race: the 409 a role switch
 * answers when the guard beneath it disagrees with the rule this API asked a
 * moment earlier, because the role set — or the actor's own roles — moved
 * between the read and the write, another owner switching something at the same
 * instant. Which of the guard's own refusals it was cannot be told from the
 * SQLSTATE, so the screen says the profile changed and to open it again, and
 * never guesses (round 58's review, item M3).
 */
export const TEAM_REFUSALS = [
  'locked',
  'last_role',
  'not_yourself',
  'not_a_working_role',
  'conflict',
] as const;
