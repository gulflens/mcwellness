/**
 * Getting a file from a person's device into a request body.
 *
 * Every body this API takes is JSON and capped at 64 KiB
 * (app/api/create-api.ts, the shared zone), so a file travels base64 and has
 * to fit. That is comfortable for a signature and tight for a photograph of an
 * A4 form, so a photograph is made smaller here before it is sent: the browser
 * already has a canvas and an encoder, and shrinking on the device is both
 * faster and kinder than sending three megabytes to be refused.
 *
 * A PDF is sent as it is. There is no honest way to compress one in a browser
 * without a library, and a silently degraded document is worse than a clear
 * refusal — so an oversized PDF is refused with a sentence that says what to
 * do instead. docs/CHANGE-REQUESTS/client-record-03.md asks for the larger
 * body cap that would make this unnecessary.
 */

export type UploadFile = {
  name: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf';
  bytesBase64: string;
  sizeBytes: number;
};

export type PreparedFile =
  { ok: true; file: UploadFile; warning?: string } | { ok: false; message: string };

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;

/**
 * How a photograph is made smaller, and in which order — which is the whole
 * of whether a signed form can still be read afterwards.
 *
 * **Size before quality, not the other way round.** This used to drop the JPEG
 * quality to 0.4 at full resolution before it tried a smaller picture at all,
 * and 0.4 is where handwriting turns to porridge: the artefacts land on the
 * thin strokes of a signature and the small print of a form. Fewer pixels of
 * clean ink beats the same page smeared. So each quality is tried at every
 * size down to a floor first, and only then does the quality step down.
 *
 * The floor is the long edge, not the width: a form is usually photographed
 * portrait, and scaling by width would shrink a portrait page far further than
 * a landscape one for the same setting. 1400px on the long edge is about
 * 170 dpi across an A4 page, which is comfortably enough to read twelve-point
 * type and a signature.
 *
 * Below the floor is a last resort rather than a step in the ladder, and it
 * says so on screen: 45 KiB is a hard ceiling until the body cap is raised
 * (CR-08), and refusing a photograph outright would be worse than filing a
 * small one with a warning beside it.
 */
const LEGIBLE_LONG_EDGE = 1400;
const LONG_EDGES = [2400, 2000, 1700, LEGIBLE_LONG_EDGE];
const QUALITIES = [0.8, 0.65, 0.5];
const LAST_RESORT_EDGES = [1100, 900, 700];
const LAST_RESORT_QUALITY = 0.5;
/**
 * A result this much smaller than the original has lost a great deal, whatever
 * size it came out at, and the person filing it should look before they file.
 */
const HEAVY_COMPRESSION = 10;

const ILLEGIBLE_WARNING =
  'This had to be made smaller than a page is usually readable at. Open it and check the writing before filing, or photograph one page at a time.';
const SHRUNK_WARNING =
  'This photograph was made much smaller to fit. Check the writing is still readable before filing it.';

function isAccepted(type: string): type is UploadFile['mimeType'] {
  return (ACCEPTED as readonly string[]).includes(type);
}

/** The bytes of a `File`, base64 encoded, without the data URL prefix. */
export async function readFileForUpload(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // In chunks: String.fromCharCode(...bytes) on a large array overflows the
  // call stack, which is a crash rather than a refusal.
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

async function encode(
  bitmap: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<{ bytesBase64: string; sizeBytes: number } | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx || typeof canvas.toDataURL !== 'function') return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  const url = canvas.toDataURL('image/jpeg', quality);
  const comma = url.indexOf(',');
  if (comma === -1) return null;
  const bytesBase64 = url.slice(comma + 1);
  // Four base64 characters carry three bytes, less whatever padding says.
  const padding = bytesBase64.endsWith('==') ? 2 : bytesBase64.endsWith('=') ? 1 : 0;
  return { bytesBase64, sizeBytes: (bytesBase64.length / 4) * 3 - padding };
}

/**
 * A file ready to send, or a refusal saying why not. An image is scaled and
 * re-encoded until it fits `maxBytes`; anything else has to fit as it stands.
 */
export async function compressToFit(file: File, maxBytes: number): Promise<PreparedFile> {
  if (!isAccepted(file.type)) {
    return {
      ok: false,
      message: 'That file is not one this practice holds. Use a photograph, or a PDF.',
    };
  }

  if (file.type === 'application/pdf') {
    if (file.size > maxBytes) {
      return {
        ok: false,
        message:
          'That PDF is too large to file here. Photograph the signed form instead, or ask for the size limit to be raised.',
      };
    }
    return {
      ok: true,
      file: {
        name: file.name,
        mimeType: 'application/pdf',
        bytesBase64: await readFileForUpload(file),
        sizeBytes: file.size,
      },
    };
  }

  // Small enough already: send exactly the bytes the person chose, rather than
  // re-encoding a picture that did not need it.
  if (file.size <= maxBytes) {
    return {
      ok: true,
      file: {
        name: file.name,
        mimeType: file.type,
        bytesBase64: await readFileForUpload(file),
        sizeBytes: file.size,
      },
    };
  }

  if (typeof createImageBitmap !== 'function') {
    return {
      ok: false,
      message: 'That photograph is too large, and this browser cannot make it smaller.',
    };
  }
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    return { ok: false, message: 'That photograph could not be read.' };
  }
  const longEdge = Math.max(bitmap.width, bitmap.height);
  /** One attempt at a given long edge and quality, or null when the canvas will not encode. */
  const attempt = async (
    edge: number,
    quality: number,
  ): Promise<{ bytesBase64: string; sizeBytes: number } | null> => {
    const scale = Math.min(1, edge / longEdge);
    return encode(
      bitmap,
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
      quality,
    );
  };
  const accept = (
    encoded: { bytesBase64: string; sizeBytes: number },
    warning?: string,
  ): PreparedFile => {
    const shrunk = file.size >= encoded.sizeBytes * HEAVY_COMPRESSION;
    return {
      ok: true,
      file: {
        name: file.name,
        mimeType: 'image/jpeg',
        bytesBase64: encoded.bytesBase64,
        sizeBytes: encoded.sizeBytes,
      },
      ...(warning ? { warning } : shrunk ? { warning: SHRUNK_WARNING } : {}),
    };
  };

  try {
    // Size first, at the best quality, down to the floor; then the next
    // quality, from the top again.
    for (const quality of QUALITIES) {
      for (const edge of LONG_EDGES) {
        const encoded = await attempt(edge, quality);
        if (!encoded) {
          return {
            ok: false,
            message: 'That photograph could not be made smaller in this browser.',
          };
        }
        if (encoded.sizeBytes <= maxBytes) return accept(encoded);
      }
    }
    // Below what a page is comfortably read at: filed, and said so.
    for (const edge of LAST_RESORT_EDGES) {
      const encoded = await attempt(edge, LAST_RESORT_QUALITY);
      if (!encoded) {
        return { ok: false, message: 'That photograph could not be made smaller in this browser.' };
      }
      if (encoded.sizeBytes <= maxBytes) return accept(encoded, ILLEGIBLE_WARNING);
    }
  } finally {
    bitmap.close?.();
  }
  return {
    ok: false,
    message:
      'That photograph is still too large after being made smaller. Photograph one page at a time.',
  };
}
