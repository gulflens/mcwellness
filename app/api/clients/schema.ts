import { z } from 'zod';

/** The shapes the client list route returns. Imported by the route and by the browser. */

export const CLIENT_STATUSES = ['lead', 'active', 'paused', 'closed', 'erased'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const ClientRow = z.object({
  id: z.uuid(),
  mrn: z.string(),
  givenName: z.string(),
  familyName: z.string(),
  givenNameAr: z.string().nullable(),
  familyNameAr: z.string().nullable(),
  age: z.number().int().nullable(),
  status: z.enum(CLIENT_STATUSES),
  contact: z.object({ relationship: z.string(), phone: z.string().nullable() }).nullable(),
  emirate: z.string().nullable(),
});
export type ClientRow = z.infer<typeof ClientRow>;

export const ClientListResponse = z.object({
  clients: z.array(ClientRow),
  /** 'schedule': the caller sees only clients on their schedule, and no schedule exists yet. */
  note: z.enum(['schedule']).nullable(),
  /** Present and true only when more clients matched than the page holds (at most 50 rows). */
  truncated: z.boolean().optional(),
});
export type ClientListResponse = z.infer<typeof ClientListResponse>;
