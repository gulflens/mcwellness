import { z } from 'zod';
import { STAFF_ROLES } from '@domain/shared';

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
 * One colleague, opened. Everything `TeamMember` carries plus what
 * `staff_profile` holds, which is why it is the owners' answer alone
 * (db/policies/core/staff_profile.sql).
 */
export const TeamProfile = TeamMember.extend({
  phone: z.string().nullable(),
  preferredLocale: z.enum(['en', 'ar']),
  startedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
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
  startedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  emergencyContactName: optionalText(120),
  emergencyContactPhone: z.string().regex(E164).nullable(),
  privateNotes: optionalText(4000),
});
export type ProfileBody = z.infer<typeof ProfileBody>;

/**
 * The codes a refusal carries, which the screen turns into a sentence
 * (design section 7). `locked` and `last_role` are 409, the other two 400.
 */
export const TEAM_REFUSALS = ['locked', 'last_role', 'not_yourself', 'not_a_working_role'] as const;
