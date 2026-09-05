import { z } from 'zod';
import { KIT_KINDS } from '@domain/session';

/**
 * The equipment register on the wire (docs/SPEC/practitioner-phone.md section
 * 6). A serial, a model, what it is, who carries it and two dates: nothing
 * here names a client, and nothing here is a measurement.
 *
 * `calibrationDueAt` and `lastCalibratedAt` are dates rather than instants on
 * the way in, because a date is the only thing the practice actually records
 * off a calibration certificate; the column is a timestamptz so an instant
 * comes back out.
 */

export const ACTIVE_STATUSES = ['active', 'inactive'] as const;

export const KitRow = z.object({
  id: z.uuid(),
  serial: z.string(),
  model: z.string(),
  kind: z.enum(KIT_KINDS),
  status: z.enum(ACTIVE_STATUSES),
  assignedPractitionerId: z.uuid().nullable(),
  /** The person's display name, so a table can be read without a second request. */
  assignedTo: z.string().nullable(),
  lastCalibratedAt: z.iso.datetime().nullable(),
  calibrationDueAt: z.iso.datetime().nullable(),
});
export type KitRow = z.infer<typeof KitRow>;

export const KitListResponse = z.object({ kit: z.array(KitRow) });
export type KitListResponse = z.infer<typeof KitListResponse>;

/** What a practitioner is offered when assigning an item. Names, not people. */
export const KitOptionsResponse = z.object({
  practitioners: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
});
export type KitOptionsResponse = z.infer<typeof KitOptionsResponse>;

const Serial = z
  .string()
  .trim()
  .min(1)
  .max(64)
  // Letters, digits, dashes, dots, spaces and slashes: what a manufacturer
  // stamps on a case. Nothing that could be a control character or a
  // bidirectional override in a table somebody reads at a glance.
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, 'Not a serial number');

export const CreateKitRequest = z.object({
  serial: Serial,
  model: z.string().trim().min(1).max(120),
  kind: z.enum(KIT_KINDS),
  assignedPractitionerId: z.uuid().nullable().default(null),
  lastCalibratedAt: z.iso.date().nullable().default(null),
  calibrationDueAt: z.iso.date().nullable().default(null),
});
export type CreateKitRequest = z.infer<typeof CreateKitRequest>;

/**
 * Every field optional: the drawer edits one item and sends what changed.
 * Recording a calibration is a PATCH of the two dates and nothing else, which
 * is the only date the practice records (section 6.4).
 */
export const UpdateKitRequest = z
  .object({
    serial: Serial.optional(),
    model: z.string().trim().min(1).max(120).optional(),
    kind: z.enum(KIT_KINDS).optional(),
    status: z.enum(ACTIVE_STATUSES).optional(),
    assignedPractitionerId: z.uuid().nullable().optional(),
    lastCalibratedAt: z.iso.date().nullable().optional(),
    calibrationDueAt: z.iso.date().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Say what to change.',
  });
export type UpdateKitRequest = z.infer<typeof UpdateKitRequest>;
