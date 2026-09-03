/**
 * Whether a setup photo can be stored at all yet.
 *
 * The device half is built and tested (app/therapist/session/photo.ts takes
 * the picture, shrinks it under a megabyte and fingerprints it). The server
 * half needs the trunk's storage seam — `c.get('storage')`, a
 * `StorageProvider` with `put(key, bytes, mimeType)` — which is landing in
 * shared-zone round 14 and has not merged. Until it does there is nowhere to
 * put the bytes, and a `document` row filed against a key nothing ever
 * uploads to is a record of a photograph that does not exist.
 *
 * So this is off, in one place, and the whole feature turns on it: the
 * practitioner is not offered the camera
 * (app/therapist/session/PostStep.tsx), the route refuses a
 * `photo_captured` event by name (./events.ts), and the close files no
 * document. When the seam merges this becomes a check for `c.get('storage')`
 * rather than a constant, and everything behind it comes back.
 *
 * Recorded in docs/CHANGE-REQUESTS/session-capture-02.md section 2.
 */
export const PHOTO_STORAGE_AVAILABLE = false;
