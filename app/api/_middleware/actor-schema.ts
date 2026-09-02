import { z } from 'zod';
import { ROLES } from '@domain/shared';

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
  tenantId: z.uuid(),
  roles: z.array(z.enum(ROLES)),
  capabilities: z.array(CapabilitySchema),
});
export type MeResponse = z.infer<typeof MeResponse>;
