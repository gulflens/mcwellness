/**
 * The basemap both of the console's browser maps draw on, in Google's own
 * styling vocabulary (docs/SPEC/route-planning.md section 4.5): a quiet,
 * achromatic ground with the roads legible and everything else out of the
 * way, so the pins and the lines are what the eye finds. Started as the day
 * map's own (`app/admin/schedule/map/`); since trunk round 43 the pin picker
 * (`app/admin/clients/pin/PinPickerPage.tsx`) draws its single marker on the
 * same basemap rather than Google's default one, so it reads as this
 * console's own screen and not a page borrowed from somewhere else — the
 * same reason `googleMaps.ts` moved to this folder first, and this
 * document's own rule for a thing two modules share (docs/SPEC/
 * OWNERSHIP.md).
 *
 * **Every colour is read from the running document**, not written out here:
 * `getComputedStyle` on the element the page hands in resolves the same
 * custom properties `app/shell/tokens.css` declares, so a token that changes
 * moves the map with it and no value is ever duplicated
 * (.claude/rules/ui.md, "never hardcode colours" — with no exception).
 * A property that resolves to nothing leaves its rule out rather than
 * inventing a colour, which is what happens under a test renderer that
 * computes no styles.
 */
export function mapStyle(root: Element): google.maps.MapTypeStyle[] {
  const computed = getComputedStyle(root);
  const token = (name: string): string | null => {
    const value = computed.getPropertyValue(name).trim();
    return value === '' ? null : value;
  };
  const paint = (
    featureType: string,
    elementType: string,
    name: string,
  ): google.maps.MapTypeStyle[] => {
    const color = token(name);
    return color === null ? [] : [{ featureType, elementType, stylers: [{ color }] }];
  };
  return [
    // The ground, the roads, and a label that reads without shouting.
    ...paint('all', 'geometry', '--paper'),
    ...paint('road', 'geometry', '--rule'),
    ...paint('all', 'labels.text.fill', '--slate'),
    ...paint('all', 'labels.text.stroke', '--paper'),
    // Water as a band lifted off the ground rather than as a colour.
    ...paint('water', 'geometry', '--surface'),
    // The noise: nothing on this map is a shop, a bus route or a border.
    { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  ];
}
