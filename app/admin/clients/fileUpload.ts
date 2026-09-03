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

export type PreparedFile = { ok: true; file: UploadFile } | { ok: false; message: string };

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
/** The widths tried in turn, largest first: legibility before size, until it fits. */
const WIDTHS = [2000, 1600, 1200, 1000, 800];
const QUALITIES = [0.7, 0.55, 0.4];

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
  try {
    for (const width of WIDTHS) {
      const scale = Math.min(1, width / bitmap.width);
      const targetWidth = Math.max(1, Math.round(bitmap.width * scale));
      const targetHeight = Math.max(1, Math.round(bitmap.height * scale));
      for (const quality of QUALITIES) {
        const encoded = await encode(bitmap, targetWidth, targetHeight, quality);
        if (!encoded) {
          return {
            ok: false,
            message: 'That photograph could not be made smaller in this browser.',
          };
        }
        if (encoded.sizeBytes <= maxBytes) {
          return {
            ok: true,
            file: {
              name: file.name,
              mimeType: 'image/jpeg',
              bytesBase64: encoded.bytesBase64,
              sizeBytes: encoded.sizeBytes,
            },
          };
        }
      }
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
