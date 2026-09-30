import { refuseSize } from '../../../../domain/reports/qeeg/image/limits';
import { prepareMap, type MapRefusal } from '../../../../domain/reports/qeeg/image/prepare';
import { openPicture } from './decodePicture';

/**
 * A chosen file made into the one kind of picture a report takes, in the
 * browser, before anything is sent (docs/SPEC/reports-qeeg.md section 9,
 * point 2): decoded, its size checked, its blank border trimmed, laid onto
 * white, written as an opaque 8-bit RGB PNG, and fingerprinted.
 *
 * **Every rule is the domain's.** The caps and their refusals, the trim, the
 * flattening and the encoding are `domain/reports/qeeg/image/`, composed in
 * `prepareMap`. This file supplies what a pure function cannot: the browser's
 * decoder (`decodePicture.ts`), its compressor (`CompressionStream`, which
 * writes the zlib stream a PNG holds), and its digest (`crypto.subtle`). The
 * size is asked once more before the pixels are drawn, with the domain's own
 * `refuseSize`, so a picture over the caps is refused before it costs its
 * pixels' memory.
 *
 * **The digest is of the bytes sent.** The door computes it again over what
 * arrived and refuses a mismatch, so a picture changed on its way is never
 * filed under another's fingerprint.
 */

export type PreparedFile =
  | {
      readonly ok: true;
      readonly png: Uint8Array;
      readonly width: number;
      readonly height: number;
      readonly trimmed: boolean;
      /** SHA-256 of `png`, 64 small hexadecimal characters, as `X-Sha256` carries it. */
      readonly sha256: string;
    }
  | { readonly ok: false; readonly refusal: MapRefusal | 'undecodable' };

/** Deflate with the zlib wrapper, as a PNG's image data is written. */
export async function deflateInBrowser(bytes: Uint8Array): Promise<Uint8Array> {
  const body = new Response(bytes as Uint8Array<ArrayBuffer>).body;
  if (body === null) throw new Error('Nothing to compress.');
  const compressed = body.pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function prepareFile(file: Blob): Promise<PreparedFile> {
  const opened = await openPicture(file);
  if (opened === null) return { ok: false, refusal: 'undecodable' };
  try {
    const early = refuseSize(opened.width, opened.height);
    if (early !== null) return { ok: false, refusal: early };
    const prepared = await prepareMap(opened.pixels(), deflateInBrowser);
    if (!prepared.ok) return prepared;
    return { ...prepared, sha256: await sha256Hex(prepared.png) };
  } finally {
    opened.close();
  }
}
