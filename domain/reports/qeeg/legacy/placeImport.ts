/**
 * A past record's pictures written into it once they are on the store, and a
 * note for each picture that could not be brought in
 * (docs/SPEC/reports-qeeg.md section 11, point 5).
 *
 * **Why this comes after the reader.** `readLegacyReport` hands the pictures
 * back beside the content, because a map is named by the id and digest of a
 * stored document, which exist only once the browser has made each picture
 * into a map and the report's own door has filed it (section 9). The browser
 * does that between bringing the record in and keeping it, and tells the keep
 * where each one went (`maps`, keyed by its place in the file, as the reader
 * keys it) and which it could not bring (`leftOut`). This writes both in.
 *
 * **A picture keeps the place it had in the file.** Each map is keyed
 * `map-` and its place, so a note about one left out (`images.map-1`) names
 * that place and no other, as the reader's own notes about an empty card do.
 * Anything keyed otherwise is refused, by its field: the reader wrote those
 * keys, and anything else was not the file's.
 *
 * **Notes are added, never taken away.** Every note the reader wrote stays, in
 * its order; one `map_not_brought_in` follows for each place left out, once.
 *
 * Pure: no I/O. It returns a new content and changes nothing it is given.
 */

import type { ImportNote, MapEntry, Ordered, QeegInitial } from '../types';

/** Where the browser put each picture, and which it could not bring. */
export type ImportPlacement = {
  readonly maps: Ordered<MapEntry>;
  readonly leftOut: readonly string[];
};

export type PlacementRefusal = 'not_a_past_record' | 'not_a_place' | 'placed_and_left_out';

export type Placed =
  | { readonly ok: true; readonly content: QeegInitial }
  | { readonly ok: false; readonly field: string; readonly reason: PlacementRefusal };

/** A picture's place in the old file, as the reader keys it. */
const PLACE = /^map-(?:0|[1-9]\d{0,3})$/;

export function placeImportedMaps(content: QeegInitial, placement: ImportPlacement): Placed {
  const { provenance } = content;
  if (provenance.origin !== 'legacy_tool') {
    return { ok: false, field: 'provenance', reason: 'not_a_past_record' };
  }
  for (const key of Object.keys(placement.maps)) {
    if (!PLACE.test(key)) return { ok: false, field: `maps.${key}`, reason: 'not_a_place' };
  }
  const notes: ImportNote[] = [...provenance.notes];
  for (const [index, key] of placement.leftOut.entries()) {
    if (!PLACE.test(key)) return { ok: false, field: `leftOut.${index}`, reason: 'not_a_place' };
    if (Object.hasOwn(placement.maps, key)) {
      return { ok: false, field: `leftOut.${index}`, reason: 'placed_and_left_out' };
    }
    const at = `images.${key}`;
    if (!notes.some((note) => note.code === 'map_not_brought_in' && note.at === at)) {
      notes.push({ code: 'map_not_brought_in', at });
    }
  }
  const maps = Object.fromEntries(
    Object.entries(placement.maps).map(([key, entry]) => [key, structuredClone(entry)]),
  );
  return {
    ok: true,
    content: {
      ...structuredClone(content),
      provenance: { ...structuredClone(provenance), notes },
      maps,
    },
  };
}
