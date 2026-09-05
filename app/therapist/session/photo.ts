/**
 * The optional setup photo (docs/SPEC/session-capture.md sections 3.5 and 7,
 * docs/SPEC/practitioner-phone.md section 4.2): taken with `<input capture>`,
 * compressed on the device to at most 1 MB, and digested so the server can
 * recognise the same file later.
 *
 * Restored unchanged from history (deleted at d22373f, when there was nowhere
 * for the bytes to go). What it returns has not moved either: a size, a type
 * and a digest, which is exactly what the `photo_captured` event carries. The
 * bytes now go into a second object store beside the events
 * (./outbox/store.ts) and travel after the event that names them, through
 * `PUT /api/sessions/:id/photo`.
 */

export const MAX_PHOTO_BYTES = 1024 * 1024;
/** Long edge, in device pixels. A setup photo is a record of electrode placement, not a portrait. */
const MAX_EDGE = 1600;
const QUALITY_STEPS = [0.8, 0.65, 0.5, 0.35] as const;

export type PreparedPhoto = {
  bytes: Blob;
  mimeType: 'image/jpeg';
  sizeBytes: number;
  sha256: string;
};

async function digest(bytes: Blob): Promise<string> {
  const buffer = await bytes.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

/**
 * Scales the picture down and re-encodes it until it fits, giving up rather
 * than shipping something too big. Returns null when the device cannot do
 * this at all — a browser with no canvas, or a file that is not an image —
 * and the screen says the photo could not be prepared instead of failing.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  for (const quality of QUALITY_STEPS) {
    const blob = await toBlob(canvas, quality);
    if (blob && blob.size <= MAX_PHOTO_BYTES) {
      return {
        bytes: blob,
        mimeType: 'image/jpeg',
        sizeBytes: blob.size,
        sha256: await digest(blob),
      };
    }
  }
  return null;
}
