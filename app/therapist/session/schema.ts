import { z } from 'zod';

/**
 * The shape this screen expects from GET /api/sessions/service-types: the
 * caller's own certified services (docs/SPEC/session-capture.md section
 * 3.1 — a practitioner needs a role and a valid `credential` for the
 * service on the day). That route is not mounted yet in `app/api/sessions/**`
 * (session-capture's own paths — see this pull request's body, "Builder
 * notes"); this file only records the contract the screen is built
 * against, mirroring the existing `GET /api/billing/service-types` shape
 * (`app/api/billing/schema.ts`'s `ServiceTypeOption`) exactly, so a future
 * implementation has one convention to match rather than a second one.
 */

export const ServiceTypeOption = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
});
export type ServiceTypeOption = z.infer<typeof ServiceTypeOption>;

export const ServiceTypeOptionsResponse = z.object({
  serviceTypes: z.array(ServiceTypeOption),
});
export type ServiceTypeOptionsResponse = z.infer<typeof ServiceTypeOptionsResponse>;
