import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type pg from 'pg';
import { clientDocumentKey } from '../../../domain/shared';
import { crc32, encodePng } from '../../../domain/reports/qeeg/image/encodePng';
import type { FigureRef } from '../../../domain/reports/qeeg/types';

/**
 * Synthetic brain maps for the figure door's tests, and a way to put a map on
 * a report as the table owner when a test needs one there before it starts.
 *
 * **No picture here is anybody's.** Every image is made from arithmetic: a
 * gradient, or a field of one colour. The practice's own exports are never
 * read, opened or copied (brief N, common rule 2).
 */

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typed = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i += 1) typed[i] = type.charCodeAt(i);
  typed.set(data, 4);
  out.set(typed, 4);
  view.setUint32(8 + data.length, crc32(typed));
  return out;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** An RGB field of `width` by `height`, a gradient seeded by `seed`, so two seeds give two files. */
export function rgbField(width: number, height: number, seed = 0): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = (i + seed) % 256;
    rgb[i * 3 + 1] = (i * 3 + seed * 7) % 256;
    rgb[i * 3 + 2] = (seed * 31) % 256;
  }
  return rgb;
}

/** The one kind the door takes: an opaque 8-bit RGB PNG, as the browser writes it. */
export async function goodPng(width = 40, height = 30, seed = 0): Promise<Uint8Array> {
  return encodePng(rgbField(width, height, seed), width, height, async (bytes) =>
    Uint8Array.from(deflateSync(bytes)),
  );
}

/** A chunk to write into a hand-made PNG: its four-letter type and its data. */
export type ExtraChunk = { type: string; data?: Uint8Array };

/**
 * A PNG written by hand, for the files the door must refuse: another colour
 * type, depth or interlace; image data whose inflated length is not what the
 * header says, or whose rows start with a filter byte PNG does not define;
 * chunks the door does not take, before or after the image data or between
 * two halves of it; bytes after the end. `rowBytes` is the length of a
 * scanline without its filter byte; the data is `rows` scanlines of
 * `filterByte` (0 unless said).
 */
export function handPng(options: {
  width: number;
  height: number;
  depth?: number;
  colourType?: number;
  interlace?: number;
  rows?: number;
  rowBytes?: number;
  filterByte?: number;
  before?: readonly ExtraChunk[];
  after?: readonly ExtraChunk[];
  /** Splits the image data in two, with these chunks between the halves. */
  between?: readonly ExtraChunk[];
  trailer?: Uint8Array;
  /** Bytes after the zlib stream, inside the image data. */
  dataTrailer?: Uint8Array;
  /** An IDAT chunk with no data, after the run's first half. */
  emptyIdat?: boolean;
  /** The image data chunk's CRC, wrong by one bit. */
  badCrc?: boolean;
  /** A header chunk of this many bytes instead of thirteen. */
  headerLength?: number;
}): Uint8Array {
  const depth = options.depth ?? 8;
  const colourType = options.colourType ?? 2;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, options.width);
  view.setUint32(4, options.height);
  header.set([depth, colourType, 0, 0, options.interlace ?? 0], 8);
  const channels = colourType === 6 ? 4 : colourType === 2 ? 3 : colourType === 4 ? 2 : 1;
  const rowBytes = options.rowBytes ?? Math.ceil((options.width * channels * depth) / 8);
  const rows = options.rows ?? options.height;
  const raw = new Uint8Array(rows * (rowBytes + 1));
  for (let i = 0; i < raw.length; i += 1) {
    raw[i] = i % (rowBytes + 1) === 0 ? (options.filterByte ?? 0) : (i * 7) % 251;
  }
  const compressed = join([
    Uint8Array.from(deflateSync(raw)),
    options.dataTrailer ?? new Uint8Array(0),
  ]);
  const extra = (list: readonly ExtraChunk[] | undefined) =>
    (list ?? []).map((c) => chunk(c.type, c.data ?? new Uint8Array([1, 2, 3])));
  const half = Math.floor(compressed.length / 2);
  const data =
    options.emptyIdat === true
      ? [
          chunk('IDAT', compressed.subarray(0, half)),
          chunk('IDAT', new Uint8Array(0)),
          chunk('IDAT', compressed.subarray(half)),
        ]
      : options.between === undefined
        ? [chunk('IDAT', compressed)]
        : [
            chunk('IDAT', compressed.subarray(0, half)),
            ...extra(options.between),
            chunk('IDAT', compressed.subarray(half)),
          ];
  if (options.badCrc === true) {
    const first = data[0];
    if (first) first[first.length - 1] = (first[first.length - 1] ?? 0) ^ 1;
  }
  return join([
    SIGNATURE,
    chunk('IHDR', header.subarray(0, options.headerLength ?? 13)),
    ...extra(options.before),
    ...data,
    ...extra(options.after),
    chunk('IEND', new Uint8Array(0)),
    options.trailer ?? new Uint8Array(0),
  ]);
}

/** The first bytes of a JPEG file and a little more: not a PNG at all. */
export function jpegBytes(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Files a picture against a report as the table owner, with no role assumed:
 * the document row and the link, exactly as `app.file_report_figure` writes
 * them, for a test that needs a map on a report before the report is signed or
 * kept. The migration's guard is what makes this possible only on a draft.
 */
export async function linkFigureAsOwner(
  owner: pg.Client,
  where: { tenantId: string; clientId: string; reportId: string },
  figure: {
    documentId: string;
    sha256: string;
    widthPx?: number;
    heightPx?: number;
    condition?: 'eyes_open' | 'eyes_closed' | null;
    position?: number | null;
  },
): Promise<FigureRef> {
  const widthPx = figure.widthPx ?? 800;
  const heightPx = figure.heightPx ?? 600;
  const exists = await owner.query('select 1 from document where id = $1', [figure.documentId]);
  if (exists.rowCount === 0) {
    await owner.query(
      'insert into document (id, tenant_id, client_id, kind, storage_key, mime_type, sha256, ' +
        "retention_until, is_immutable) values ($1, $2, $3, 'report_figure', $4, 'image/png', " +
        "decode($5, 'hex'), now() + interval '5 years', false)",
      [
        figure.documentId,
        where.tenantId,
        where.clientId,
        clientDocumentKey(where.tenantId, where.clientId, figure.documentId),
        figure.sha256,
      ],
    );
  }
  await owner.query(
    'insert into report_figure (tenant_id, client_id, report_id, document_id, sha256, width_px, ' +
      "height_px, condition, position) values ($1, $2, $3, $4, decode($5, 'hex'), $6, $7, $8, $9)",
    [
      where.tenantId,
      where.clientId,
      where.reportId,
      figure.documentId,
      figure.sha256,
      widthPx,
      heightPx,
      figure.condition ?? null,
      figure.position ?? null,
    ],
  );
  return { figureId: figure.documentId, sha256: figure.sha256, widthPx, heightPx };
}
