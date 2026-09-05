import type { ServerStorageProvider } from '../_middleware/storage';

/**
 * Whether a setup photograph can be stored at all in this deployment.
 *
 * This was a constant, `PHOTO_STORAGE_AVAILABLE = false`, because the trunk's
 * storage seam had not landed and there was nowhere to put the bytes. It has,
 * and this is now what that file said it would become: a check for the seam
 * rather than a flag (docs/SPEC/practitioner-phone.md section 4.1,
 * docs/CHANGE-REQUESTS/session-capture-02.md section 2).
 *
 * It is still one place, and the whole feature still turns on it: the route
 * that takes the bytes refuses without a store (./photo.ts), the events route
 * refuses a `photo_captured` event by name (./events.ts), and the check-in
 * answer tells the device whether to offer the camera at all
 * (app/therapist/session/PostStep.tsx). A deployment with no store configured
 * is refused cleanly rather than assumed away, exactly as every other use of
 * `c.get('storage')` is.
 */
export function photoStorageAvailable(
  storage: ServerStorageProvider | undefined,
): storage is ServerStorageProvider {
  return storage !== undefined;
}
