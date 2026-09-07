/**
 * The day map's basemap, in Google's own styling vocabulary
 * (docs/SPEC/route-planning.md section 4.5): a quiet, achromatic ground with
 * the roads legible and everything else out of the way, so the pins and the
 * lines are what the eye finds.
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
