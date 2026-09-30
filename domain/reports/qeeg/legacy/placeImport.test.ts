import { describe, expect, it } from 'vitest';
import { validateQeegContent } from '../shape';
import type { MapEntry, Ordered, QeegInitial } from '../types';
import { buildLegacyFile, readLegacyFile } from '../testing/legacyFile';
import { placeImportedMaps } from './placeImport';

/**
 * Where a past record's pictures go once they are on the store, and what is
 * written for a picture that could not be brought in
 * (docs/SPEC/reports-qeeg.md section 11, point 5).
 */

const SHA = 'c'.repeat(64);

function imported(): QeegInitial {
  return readLegacyFile(buildLegacyFile(), SHA).content;
}

function mapAt(place: number, position: number): MapEntry & { position: number } {
  return {
    figureId: `00000009-0000-4000-8000-00000000000${place}`,
    sha256: String(place).repeat(64),
    widthPx: 800,
    heightPx: 600,
    condition: place === 0 ? 'eyes_open' : 'eyes_closed',
    caption: null,
    position,
  };
}

describe('placing a past record’s pictures', () => {
  it('writes the uploaded maps in, each under the key of its place in the file', () => {
    const maps: Ordered<MapEntry> = { 'map-0': mapAt(0, 0), 'map-1': mapAt(1, 1) };
    const placed = placeImportedMaps(imported(), { maps, leftOut: [] });
    if (!placed.ok) throw new Error(placed.field);
    expect(placed.content.maps).toEqual(maps);
    expect(validateQeegContent(placed.content).ok).toBe(true);
  });

  it('records a picture left out as a note naming its place, never what it held', () => {
    const before = imported();
    const placed = placeImportedMaps(before, {
      maps: { 'map-0': mapAt(0, 0) },
      leftOut: ['map-1'],
    });
    if (!placed.ok) throw new Error(placed.field);
    if (placed.content.provenance.origin !== 'legacy_tool') throw new Error('not a past record');
    expect(placed.content.provenance.notes).toContainEqual({
      code: 'map_not_brought_in',
      at: 'images.map-1',
    });
    // Every note the reader wrote is still there, in its order, before the new one.
    if (before.provenance.origin !== 'legacy_tool') throw new Error('not a past record');
    expect(placed.content.provenance.notes.slice(0, before.provenance.notes.length)).toEqual(
      before.provenance.notes,
    );
    expect(validateQeegContent(placed.content).ok).toBe(true);
  });

  it('writes one note for a place left out twice', () => {
    const placed = placeImportedMaps(imported(), { maps: {}, leftOut: ['map-1', 'map-1'] });
    if (!placed.ok || placed.content.provenance.origin !== 'legacy_tool')
      throw new Error('refused');
    expect(
      placed.content.provenance.notes.filter((note) => note.code === 'map_not_brought_in'),
    ).toHaveLength(1);
  });

  it('refuses a place that is not one the reader names', () => {
    const placed = placeImportedMaps(imported(), { maps: {}, leftOut: ['signature'] });
    expect(placed).toEqual({ ok: false, field: 'leftOut.0', reason: 'not_a_place' });
    const keyed = placeImportedMaps(imported(), { maps: { first: mapAt(0, 0) }, leftOut: [] });
    expect(keyed).toEqual({ ok: false, field: 'maps.first', reason: 'not_a_place' });
  });

  it('refuses a place both placed and left out', () => {
    const placed = placeImportedMaps(imported(), {
      maps: { 'map-0': mapAt(0, 0) },
      leftOut: ['map-0'],
    });
    expect(placed).toEqual({ ok: false, field: 'leftOut.0', reason: 'placed_and_left_out' });
  });

  it('refuses a report that was not read from the old tool', () => {
    const content = { ...imported(), provenance: { origin: 'app' as const } };
    expect(placeImportedMaps(content, { maps: {}, leftOut: [] })).toEqual({
      ok: false,
      field: 'provenance',
      reason: 'not_a_past_record',
    });
  });

  it('changes nothing it is given', () => {
    const content = imported();
    const copy = structuredClone(content);
    placeImportedMaps(content, { maps: { 'map-0': mapAt(0, 0) }, leftOut: ['map-1'] });
    expect(content).toEqual(copy);
  });
});
