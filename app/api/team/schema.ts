import { z } from 'zod';
import { STAFF_ROLES } from '@domain/shared';

/**
 * What Settings › Team sends and is answered (trunk round 39, 2026-09-10).
 *
 * A member of staff is a name, an address to sign in with, a status and the
 * roles they hold. The one thing that crosses the wire once and is never
 * stored is the temporary password a new sign-in is created with: the
 * operator's decision of 10 September, so a colleague can be given their way
 * in across a desk or by WhatsApp until a "change my password" screen exists.
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

export const GrantBody = z.object({ role: z.enum(STAFF_ROLES) });
export const StatusBody = z.object({ status: z.enum(['active', 'suspended']) });
