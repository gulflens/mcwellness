/**
 * Enough of `google.maps` for the day map's own tests: a map that records
 * what it was given, an overlay whose projection is a plain linear one, and
 * a polyline that remembers its path. Nothing here reaches a network, and no
 * test in this repository ever loads Google's own script.
 *
 * The projection maps a coordinate to a pixel by a fixed scale about a fixed
 * origin, so a test can assert that two stops are drawn in different places
 * without asserting anything about Mercator.
 */
export type FakeMapsState = {
  maps: typeof google.maps;
  polylines: { path: { lat: number; lng: number }[] }[];
  fitted: number;
};

export function fakeGoogleMaps(): FakeMapsState {
  const state: FakeMapsState = { maps: null as never, polylines: [], fitted: 0 };

  class LatLngBounds {
    extend(): this {
      return this;
    }
    isEmpty(): boolean {
      return false;
    }
  }
  class MapClass {
    element: HTMLElement;
    options: unknown;
    constructor(element: HTMLElement, options: unknown) {
      this.element = element;
      this.options = options;
    }
    fitBounds(): void {
      state.fitted += 1;
    }
    panTo(): void {}
    setOptions(): void {}
    addListener(): { remove: () => void } {
      return { remove: () => undefined };
    }
  }
  class OverlayView {
    private map: unknown = null;
    setMap(map: unknown): void {
      this.map = map;
      if (map === null) {
        (this as unknown as { onRemove?: () => void }).onRemove?.();
        return;
      }
      (this as unknown as { onAdd?: () => void }).onAdd?.();
      (this as unknown as { draw?: () => void }).draw?.();
    }
    getMap(): unknown {
      return this.map;
    }
    getPanes(): Record<string, HTMLElement> {
      return { overlayMouseTarget: document.createElement('div') };
    }
    getProjection(): {
      fromLatLngToDivPixel: (point: { lat: number; lng: number }) => { x: number; y: number };
    } {
      return {
        fromLatLngToDivPixel: (point) => ({
          x: Math.round((point.lng - 55) * 1000),
          y: Math.round((26 - point.lat) * 1000),
        }),
      };
    }
  }
  class Polyline {
    options: { path?: { lat: number; lng: number }[] };
    constructor(options: { path?: { lat: number; lng: number }[] }) {
      this.options = options;
      state.polylines.push({ path: options.path ?? [] });
    }
    setMap(): void {}
  }

  state.maps = {
    Map: MapClass,
    OverlayView,
    Polyline,
    LatLngBounds,
  } as unknown as typeof google.maps;
  return state;
}
