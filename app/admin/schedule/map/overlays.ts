import type { GoogleMaps } from './googleMaps';

/**
 * One overlay, for its projection alone (docs/SPEC/route-planning.md section
 * 4.3). Google's own markers are pictures: they cannot be tabbed to, read
 * aloud or asserted on, so the pins this map draws are the app's own DOM in
 * a layer above the canvas, and this is the only thing that has to be an
 * `OverlayView` — the object that can turn a coordinate into a pixel and
 * says when the map has moved.
 *
 * The class is built after the API has loaded, because `maps.OverlayView`
 * does not exist before it.
 */
export type Projection = { toPixel(point: { lat: number; lng: number }): { x: number; y: number } };

export function createProjectionBridge(
  maps: GoogleMaps,
  onProjection: (projection: Projection | null) => void,
): google.maps.OverlayView {
  class ProjectionBridge extends maps.OverlayView {
    override onAdd(): void {}
    override draw(): void {
      const projection = this.getProjection();
      onProjection(
        projection === undefined || projection === null
          ? null
          : {
              toPixel: (point) => {
                const pixel = projection.fromLatLngToDivPixel(
                  point as unknown as google.maps.LatLng,
                );
                return { x: pixel?.x ?? 0, y: pixel?.y ?? 0 };
              },
            },
      );
    }
    override onRemove(): void {
      onProjection(null);
    }
  }
  return new ProjectionBridge();
}
