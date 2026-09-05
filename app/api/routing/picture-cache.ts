/**
 * The day's picture, held in this process's memory and in no table
 * (docs/SPEC/practitioner-phone.md section 5.3).
 *
 * **Why no table.** A picture of a practitioner's day shows several
 * households' positions at once. There is no single `client_id` to file it
 * under, so it could not be attributed in the audit trail, could not follow
 * one client's retention and could not be taken away by one client's erasure.
 * A map of where a practitioner drove is exactly the kind of thing that must
 * not accumulate, so it lives as long as the day and no longer: in this
 * process until the practice's day ends, and on the device in the worker's own
 * cache beside the day it belongs to.
 *
 * **What a key is.** The practitioner, the date and a fingerprint of the
 * ordered coordinates. The fingerprint is what makes a moved stop a different
 * picture rather than a stale one, and it is also the `v=` the device asks
 * with, so a cached answer on the phone can never be the wrong day's map.
 *
 * Capped, and swept on write: an unbounded map in a long-lived process is a
 * leak whatever it holds, and this one holds pictures.
 */

export const MAX_ENTRIES = 200;

type Entry = { bytes: Uint8Array; expiresAt: number };

const entries = new Map<string, Entry>();

export function pictureKey(practitionerId: string, date: string, fingerprint: string): string {
  return `${practitionerId}:${date}:${fingerprint}`;
}

/** Drops what has expired, then the oldest, until the cap is met. */
function sweep(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
  // Map iterates in insertion order, so the first key is the oldest written.
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next();
    if (oldest.done) break;
    entries.delete(oldest.value);
  }
}

export function readPicture(key: string, now: Date): Uint8Array | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now.getTime()) {
    entries.delete(key);
    return null;
  }
  return entry.bytes;
}

export function writePicture(key: string, bytes: Uint8Array, expiresAt: Date): void {
  entries.set(key, { bytes, expiresAt: expiresAt.getTime() });
  sweep(Date.now());
}

/** Everything, gone. For the tests, and for nothing else. */
export function forgetPictures(): void {
  entries.clear();
}

export function pictureCount(): number {
  return entries.size;
}
