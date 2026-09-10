import { useEffect, useMemo, useRef, useState } from 'react';
import type { PracticeDayPractitioner } from '../../../api/routing/schema';
import type { GoogleMaps } from '../../../shell/maps/googleMaps';
import { mapStyle } from '../../../shell/maps/mapStyle';
import { createProjectionBridge, type Projection } from './overlays';

/**
 * One practitioner's day, drawn (docs/SPEC/route-planning.md section 4.3):
 * the base as a pin marked "H", each stop as a pin numbered in time order, a
 * hairline straight line from each place to the next, and at each line's
 * midpoint the drive between them.
 *
 * **The pins are the app's own DOM.** A marker drawn by Google is a picture:
 * it cannot be tabbed to, read aloud, or asserted on. So exactly one
 * `OverlayView` is created, for its projection alone, and the pins and the
 * labels are React elements in a layer above the canvas — real buttons, in
 * the tab order, that a screen reader names and a test can find. The lines
 * stay `Polyline`s, which are geometry and carry no text.
 *
 * **No hue.** The brief reserves hue for the bands and the three status
 * states, so a pin is a number on the surface colour and nothing else.
 */

const DEFAULT_CENTRE = { lat: 25.2, lng: 55.27 };
const DEFAULT_ZOOM = 11;

/**
 * How far in the coordinator may go, and why there is a limit at all.
 *
 * Google is told the map's viewport by the tile requests the browser makes,
 * which is inside what `docs/COMPLIANCE/approved-vendors.md` discloses. But
 * `fitBounds` on a day with one stop collapses the viewport onto that
 * household's own coordinate, and at full zoom the tiles asked for would place
 * a home to within a few metres — a household's address handed over by
 * arithmetic rather than by decision (the review of this pull request, note
 * N4). Sixteen shows a neighbourhood and its street pattern, which is what
 * the coordinator needs to see where a visit sits, and no more.
 */
const MAX_ZOOM = 16;

export type DayMapProps = {
  maps: GoogleMaps;
  /**
   * The day being shown, or null when nobody has a stop that day. The map is
   * still drawn: a coordinator opening an empty day should see the city they
   * work in, centred and quiet, not a blank panel they cannot tell apart from
   * a map that failed to load. Every reader of a stop below stands down when
   * this is null, and the map falls back to `DEFAULT_CENTRE`.
   */
  day: PracticeDayPractitioner | null;
  selectedId: string | null;
  onSelect: (appointmentId: string) => void;
};

/**
 * "about 25 min, 18 km, estimate from traffic", or "about 25 min,
 * straight-line estimate" (docs/SPEC/practitioner-phone.md section 5.4, the
 * same wording the practitioner reads). Commas and no middle dot; always the
 * word estimate; never a point time. The fallback carries no distance: a
 * straight line's kilometres beside the word estimate offer a precision the
 * arithmetic does not have.
 */
export function formatDrive(
  leg: { seconds: number; metres: number; source: string } | undefined,
): string {
  if (leg === undefined) return '– –';
  const minutes = Math.max(1, Math.round(leg.seconds / 60));
  if (leg.source !== 'traffic') return `about ${minutes} min, straight-line estimate`;
  return `about ${minutes} min, ${Math.round(leg.metres / 1000)} km, estimate from traffic`;
}

/** The short form beside a line on the map: the minutes and nothing else. */
function shortDrive(leg: { seconds: number } | undefined): string {
  if (leg === undefined) return '– –';
  return `about ${Math.max(1, Math.round(leg.seconds / 60))} min`;
}

function token(name: string): string | undefined {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? undefined : value;
}

export function DayMap({ maps, day, selectedId, onSelect }: DayMapProps) {
  const canvas = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);

  /** The base first, then every stop in window order: the day as a route. */
  const places = useMemo(() => {
    const ordered: { key: string; point: { lat: number; lng: number } }[] = [];
    if (day === null) return ordered;
    if (day.homeBase) ordered.push({ key: 'base', point: day.homeBase.point });
    for (const stop of day.stops) ordered.push({ key: stop.appointmentId, point: stop.point });
    return ordered;
  }, [day]);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const created = new maps.Map(element, {
      center: places[0]?.point ?? DEFAULT_CENTRE,
      zoom: DEFAULT_ZOOM,
      maxZoom: MAX_ZOOM,
      disableDefaultUI: true,
      clickableIcons: false,
      styles: mapStyle(),
      backgroundColor: token('--paper'),
    });
    const bridge = createProjectionBridge(maps, setProjection);
    bridge.setMap(created);
    setMap(created);
    return () => {
      bridge.setMap(null);
      setMap(null);
    };
    // The map is built once per namespace and per element; the day's own
    // changes are drawn by the effects below, which is what keeps a redraw
    // from throwing the coordinator's pan and zoom away.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps]);

  // The day's own extent, whenever the day changes.
  useEffect(() => {
    if (map === null || places.length === 0) return;
    const bounds = new maps.LatLngBounds();
    for (const place of places) bounds.extend(place.point as unknown as google.maps.LatLng);
    map.fitBounds(bounds);
  }, [map, maps, places]);

  // One line through the base and every stop in order.
  useEffect(() => {
    if (map === null || places.length < 2) return;
    const line = new maps.Polyline({
      path: places.map((place) => place.point) as unknown as google.maps.LatLng[],
      map,
      strokeOpacity: 1,
      strokeWeight: 1,
      strokeColor: token('--slate'),
      clickable: false,
    });
    return () => {
      line.setMap(null);
    };
  }, [map, maps, places]);

  const at = (point: { lat: number; lng: number }): { left: number; top: number } | null => {
    if (projection === null) return null;
    const pixel = projection.toPixel(point);
    return { left: pixel.x, top: pixel.y };
  };

  const legFor = (appointmentId: string) => day?.legs.find((leg) => leg.toStopId === appointmentId);

  return (
    <div className="daymap">
      <div className="daymap__canvas" ref={canvas} />
      <div className="daymap__layer">
        {day?.homeBase
          ? (() => {
              const position = at(day.homeBase.point);
              if (position === null) return null;
              return (
                <span
                  className="daymap__pin daymap__pin--base"
                  style={{ left: position.left, top: position.top }}
                  aria-hidden="true"
                >
                  H
                </span>
              );
            })()
          : null}
        {(day?.stops ?? []).map((stop, index) => {
          const position = at(stop.point);
          if (position === null) return null;
          return (
            <button
              key={stop.appointmentId}
              type="button"
              className="daymap__pin"
              style={{ left: position.left, top: position.top }}
              aria-current={selectedId === stop.appointmentId ? 'true' : undefined}
              aria-label={`Stop ${index + 1} on the map`}
              onClick={() => onSelect(stop.appointmentId)}
            >
              {index + 1}
            </button>
          );
        })}
        {places.slice(1).map((place, index) => {
          const from = places[index];
          if (from === undefined) return null;
          const midpoint = at({
            lat: (from.point.lat + place.point.lat) / 2,
            lng: (from.point.lng + place.point.lng) / 2,
          });
          if (midpoint === null) return null;
          return (
            <span
              key={`leg-${place.key}`}
              className="daymap__leg"
              style={{ left: midpoint.left, top: midpoint.top }}
            >
              {shortDrive(legFor(place.key))}
            </span>
          );
        })}
      </div>
    </div>
  );
}
