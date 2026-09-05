import { z } from 'zod';
import { ROLES } from '@domain/shared/actor';

/** What the database's resolver returns for a signed-in person. */
export const CapabilitySchema = z.object({
  serviceTypeId: z.uuid(),
  canExecuteSession: z.boolean(),
  canAuthorProtocol: z.boolean(),
  canSignReport: z.boolean(),
  validFrom: z.iso.date(),
  validTo: z.iso.date().nullable(),
});

export const ResolvedActorRow = z.object({
  user_id: z.uuid(),
  tenant_id: z.uuid(),
  status: z.literal('active'),
  roles: z.array(z.enum(ROLES)),
  capabilities: z.array(CapabilitySchema),
});

/** What `GET /api/me` answers; parsing the output guarantees nothing extra leaks. */
export const MeResponse = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  tenantId: z.uuid(),
  roles: z.array(z.enum(ROLES)),
  capabilities: z.array(CapabilitySchema),
  /**
   * The person's own language (`app_user.preferred_locale`), so the portal
   * opens in it rather than guessing from the browser
   * (docs/CHANGE-REQUESTS/client-portal-05.md item 2). A household invited by
   * the practice is given the language on the client's record.
   *
   * It carries the column's own default rather than being required, and that
   * is deliberate on both sides of the wire. Reading: a browser holding a
   * build from before this field existed still parses an answer that has it,
   * and a browser holding this build still parses an answer from an API that
   * does not — a field added to a shape both halves parse should not be a
   * deployment order somebody has to get right. Writing: every screen test in
   * this repository builds a `MeResponse` by hand, in files five streams own
   * (docs/SPEC/OWNERSHIP.md), and English is what each of them means.
   */
  preferredLocale: z.enum(['en', 'ar']).default('en'),
});
export type MeResponse = z.infer<typeof MeResponse>;
